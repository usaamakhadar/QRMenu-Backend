import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient, OrderStatus } from '@prisma/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    },
});

const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'qrmenu_super_secret_jwt_key_change_in_production';

// ─── FILE UPLOAD SETUP (ImgBB Memory Storage) ──────────────────────
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    },
});


app.use(cors());
app.use(express.json());

// Health check root endpoint
app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: 'QRMenu Backend API is running successfully!' });
});

// Log requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve uploaded images as static files (legacy fallback for older local images)
const uploadsDir = path.join(process.cwd(), 'uploads');
if (fs.existsSync(uploadsDir)) {
    app.use('/uploads', express.static(uploadsDir));
}

// POST /api/upload — Upload an image to ImgBB, get back its public URL
app.post('/api/upload', upload.single('image'), async (req: any, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided.' });
    }

    try {
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            return res.status(500).json({ error: 'Cloudinary environment variables are not configured.' });
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'qrmenu' },
            (error, result) => {
                if (error || !result) {
                    console.error('Cloudinary upload error:', error);
                    return res.status(500).json({ error: 'Failed to upload image to Cloudinary.' });
                }
                return res.json({ url: result.secure_url });
            }
        );

        uploadStream.end(req.file.buffer);
    } catch (error) {
        console.error('Error during Cloudinary upload:', error);
        return res.status(500).json({ error: 'Internal server error during upload.' });
    }
});

// ─── JWT MIDDLEWARE ──────────────────────────────────────────────────────────
function verifyToken(req: any, res: any, next: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; restaurantId: string; slug: string };
        req.user = decoded;
        req.restaurant = { restaurantId: decoded.restaurantId, slug: decoded.slug };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

// POST /api/auth/register — Create a new restaurant account and owner User
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
        const existingEmail = await prisma.user.findFirst({ where: { email } });
        if (existingEmail) {
            return res.status(400).json({ error: 'This email is already registered.' });
        }

        let slug = slugify(name);
        const existingSlug = await prisma.restaurant.findUnique({ where: { slug } });
        if (existingSlug) {
            slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const result = await prisma.$transaction(async (tx) => {
            const restaurant = await tx.restaurant.create({
                data: { name, slug },
            });

            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'OWNER',
                    restaurantId: restaurant.id,
                },
            });

            // Default Table
            await tx.table.create({
                data: {
                    tableNumber: '1',
                    qrCodeData: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://qrmenu-digital.vercel.app'}/${slug}?table=1`,
                    restaurantId: restaurant.id,
                },
            });

            // Default Category
            const category = await tx.category.create({
                data: { name: 'General', restaurantId: restaurant.id },
            });

            // Default Menu Item
            await tx.menuItem.create({
                data: {
                    name: 'Welcome Drink',
                    description: 'A refreshing welcome drink, compliments of the house.',
                    price: 2.99,
                    isAvailable: true,
                    categoryId: category.id,
                    restaurantId: restaurant.id,
                },
            });

            return { restaurant, user };
        });

        const token = jwt.sign(
            { userId: result.user.id, role: result.user.role, restaurantId: result.restaurant.id, slug: result.restaurant.slug },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`New restaurant registered: ${result.restaurant.name} (${result.restaurant.slug})`);
        return res.status(201).json({
            token,
            restaurant: { id: result.restaurant.id, name: result.restaurant.name, slug: result.restaurant.slug, email: result.user.email },
        });
    } catch (error) {
        console.error('Error registering restaurant:', error);
        return res.status(500).json({ error: 'Failed to register. Please try again.' });
    }
});

// POST /api/auth/login — Login with email + password, receive JWT
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const cleanEmail = email.trim().toLowerCase();
        const user = await prisma.user.findFirst({
            where: {
                email: {
                    equals: cleanEmail,
                    mode: 'insensitive'
                }
            },
            include: { restaurant: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { userId: user.id, role: user.role, restaurantId: user.restaurantId, slug: user.restaurant.slug },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`User logged in: ${user.email}`);
        return res.json({
            token,
            restaurant: {
                id: user.restaurant.id,
                name: user.restaurant.name,
                slug: user.restaurant.slug,
                email: user.email,
            },
        });
    } catch (error) {
        console.error('Error during login:', error);
        return res.status(500).json({ error: 'Failed to login. Please try again.' });
    }
});

// GET /api/auth/me — Verify token and return user & restaurant info
app.get('/api/auth/me', verifyToken, async (req: any, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            include: { restaurant: true }
        });
        if (!user) return res.status(404).json({ error: 'User not found.' });
        return res.json({
            id: user.restaurant.id,
            name: user.restaurant.name,
            slug: user.restaurant.slug,
            email: user.email,
            taxRate: user.restaurant.taxRate,
            exchangeRate: user.restaurant.exchangeRate,
            systemMode: user.restaurant.systemMode || 'FULL_POS',
            logoUrl: user.restaurant.logoUrl,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch restaurant info.' });
    }
});

// PATCH /api/auth/logo — Update restaurant logo
app.patch('/api/auth/logo', verifyToken, async (req: any, res) => {
    const { logoUrl } = req.body;
    try {
        const updated = await prisma.restaurant.update({
            where: { id: req.restaurant.restaurantId },
            data: { logoUrl },
            select: { logoUrl: true }
        });
        return res.json({ success: true, logoUrl: updated.logoUrl });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to update logo.' });
    }
});

// ─── STAFF ACCOUNTS MANAGEMENT ────────────────────────────────────────────────
// GET /api/restaurants/:id/users — List all staff accounts for a restaurant
app.get('/api/restaurants/:id/users', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }
    try {
        const users = await prisma.user.findMany({
            where: { restaurantId: id },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
            orderBy: { createdAt: 'asc' }
        });
        return res.json(users);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch staff users.' });
    }
});

// POST /api/restaurants/:id/users — Create a new staff account (Kitchen/Cashier/Owner)
app.post('/api/restaurants/:id/users', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id || req.user.role !== 'OWNER') {
        return res.status(403).json({ error: 'Only restaurant owners can create staff accounts.' });
    }
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'Name, email, password, and role are required.' });
    }
    if (!['OWNER', 'KITCHEN', 'CASHIER'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
    }

    try {
        const existing = await prisma.user.findFirst({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: 'This email is already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: role as 'OWNER' | 'KITCHEN' | 'CASHIER',
                restaurantId: id
            },
            select: { id: true, name: true, email: true, role: true, createdAt: true }
        });

        return res.status(201).json(newUser);
    } catch (error) {
        console.error('Error creating staff account:', error);
        return res.status(500).json({ error: 'Failed to create staff account.' });
    }
});

// DELETE /api/users/:userId — Delete a staff user account
app.delete('/api/users/:userId', verifyToken, async (req: any, res) => {
    const { userId } = req.params;
    if (req.user.role !== 'OWNER') {
        return res.status(403).json({ error: 'Only owners can delete staff accounts.' });
    }
    if (req.user.userId === userId) {
        return res.status(400).json({ error: 'You cannot delete your own owner account.' });
    }

    try {
        const targetUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!targetUser || targetUser.restaurantId !== req.restaurant.restaurantId) {
            return res.status(404).json({ error: 'User not found.' });
        }

        await prisma.user.delete({ where: { id: userId } });
        return res.json({ success: true, message: 'Staff user deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to delete staff user.' });
    }
});

// ─── RESTAURANT ROUTES ───────────────────────────────────────────────────────

// POST /api/restaurants — legacy alias used by /signup page (same logic as /api/auth/register)
app.post('/api/restaurants', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    try {
        const existingEmail = await prisma.user.findFirst({ where: { email } });
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        let slug = slugify(name);
        const existingSlug = await prisma.restaurant.findUnique({ where: { slug } });
        if (existingSlug) {
            slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const result = await prisma.$transaction(async (tx) => {
            const restaurant = await tx.restaurant.create({
                data: { name, slug },
            });
            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'OWNER',
                    restaurantId: restaurant.id,
                },
            });
            await tx.table.create({
                data: {
                    tableNumber: '1',
                    qrCodeData: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://qrmenu-digital.vercel.app'}/${slug}?table=1`,
                    restaurantId: restaurant.id,
                },
            });
            const category = await tx.category.create({
                data: { name: 'General', restaurantId: restaurant.id },
            });
            await tx.menuItem.create({
                data: {
                    name: 'Welcome Drink',
                    description: 'A refreshing welcome drink, compliments of the house.',
                    price: 2.99,
                    isAvailable: true,
                    categoryId: category.id,
                    restaurantId: restaurant.id,
                },
            });
            return { restaurant, user };
        });

        const token = jwt.sign(
            { userId: result.user.id, role: result.user.role, restaurantId: result.restaurant.id, slug: result.restaurant.slug },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`New restaurant registered via /signup: ${result.restaurant.name} (${result.restaurant.slug})`);
        return res.status(201).json({
            token,
            id: result.restaurant.id,
            name: result.restaurant.name,
            slug: result.restaurant.slug,
            email: result.user.email,
        });
    } catch (error) {
        console.error('Error registering restaurant:', error);
        return res.status(500).json({ error: 'Failed to register restaurant' });
    }
});


app.get('/api/restaurants/:slug', async (req, res) => {
    const { slug } = req.params;

    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug },
            include: {
                categories: true,
                menuItems: {
                    include: { category: true },
                },
                tables: true,
            },
        });

        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        return res.json(restaurant);
    } catch (error) {
        console.error('Error fetching restaurant:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET restaurant by UUID (for staff portal - protected)
app.get('/api/restaurants/by-id/:id', verifyToken, async (req: any, res) => {
    const { id } = req.params;

    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { id },
            include: {
                categories: true,
                menuItems: { include: { category: true } },
                tables: true,
            },
        });

        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        return res.json(restaurant);
    } catch (error) {
        console.error('Error fetching restaurant by ID:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST verify owner password (for management PIN gate in portal)
app.post('/api/restaurants/:id/verify-password', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    const { password } = req.body;

    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    if (!password) {
        return res.status(400).json({ error: 'Password is required.' });
    }

    try {
        const owner = await prisma.user.findFirst({
            where: { restaurantId: id, role: 'OWNER' }
        });
        if (!owner) return res.status(404).json({ error: 'Owner account not found' });

        const isValid = await bcrypt.compare(password, owner.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        return res.json({ success: true });
    } catch (error) {
        console.error('Error verifying password:', error);
        return res.status(500).json({ error: 'Failed to verify password' });
    }
});

// PATCH /api/restaurants/:id/settings — Update restaurant settings including systemMode
app.patch('/api/restaurants/:id/settings', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    const {
        name, taxRate, exchangeRate, systemMode, address, phone,
        zaadNumber, edahabNumber, premierWalletNumber, description,
        openingHours, receiptFooter
    } = req.body;

    try {
        const dataToUpdate: any = {};
        if (name !== undefined) dataToUpdate.name = name;
        if (taxRate !== undefined) dataToUpdate.taxRate = parseFloat(taxRate);
        if (exchangeRate !== undefined) dataToUpdate.exchangeRate = parseFloat(exchangeRate);
        if (systemMode !== undefined) dataToUpdate.systemMode = systemMode;
        if (address !== undefined) dataToUpdate.address = address;
        if (phone !== undefined) dataToUpdate.phone = phone;
        if (zaadNumber !== undefined) dataToUpdate.zaadNumber = zaadNumber;
        if (edahabNumber !== undefined) dataToUpdate.edahabNumber = edahabNumber;
        if (premierWalletNumber !== undefined) dataToUpdate.premierWalletNumber = premierWalletNumber;
        if (description !== undefined) dataToUpdate.description = description;
        if (openingHours !== undefined) dataToUpdate.openingHours = openingHours;
        if (receiptFooter !== undefined) dataToUpdate.receiptFooter = receiptFooter;

        const updated = await prisma.restaurant.update({
            where: { id },
            data: dataToUpdate,
        });

        return res.json(updated);
    } catch (error) {
        console.error('Error updating settings:', error);
        return res.status(500).json({ error: 'Failed to update restaurant settings.' });
    }
});

// ─── TABLE MANAGEMENT CRUD ───────────────────────────────────────────────────



// GET tables for a restaurant
app.get('/api/restaurants/:id/tables', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }
    try {
        const tables = await prisma.table.findMany({
            where: { restaurantId: id },
            orderBy: { tableNumber: 'asc' },
        });
        return res.json(tables);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch tables' });
    }
});

// POST create a new table
app.post('/api/restaurants/:id/tables', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    const { tableNumber } = req.body;

    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    if (!tableNumber || !tableNumber.toString().trim()) {
        return res.status(400).json({ error: 'Table number is required.' });
    }

    try {
        // Check if table number already exists for this restaurant
        const existing = await prisma.table.findFirst({
            where: { restaurantId: id, tableNumber: tableNumber.toString().trim() },
        });
        if (existing) {
            return res.status(400).json({ error: `Table #${tableNumber} already exists.` });
        }

        const restaurant = await prisma.restaurant.findUnique({ where: { id } });
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

        const table = await prisma.table.create({
            data: {
                tableNumber: tableNumber.toString().trim(),
                qrCodeData: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://qrmenu-digital.vercel.app'}/${restaurant.slug}?table=${tableNumber}`,
                restaurantId: id,
            },
        });
        return res.status(201).json(table);
    } catch (error) {
        console.error('Error creating table:', error);
        return res.status(500).json({ error: 'Failed to create table' });
    }
});

// DELETE a table
app.delete('/api/tables/:tableId', verifyToken, async (req: any, res) => {
    const { tableId } = req.params;
    try {
        const table = await prisma.table.findUnique({ where: { id: tableId } });
        if (!table) return res.status(404).json({ error: 'Table not found' });
        if (table.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }
        // Delete all dependent records first to ensure no foreign key constraint violations
        await prisma.$transaction([
            prisma.orderItem.deleteMany({ where: { order: { tableId } } }),
            prisma.order.deleteMany({ where: { tableId } }),
            prisma.tableSession.deleteMany({ where: { tableId } }),
            prisma.table.delete({ where: { id: tableId } })
        ]);
        return res.json({ success: true });
    } catch (error) {
        console.error('Error deleting table:', error);
        return res.status(500).json({ error: 'Failed to delete table' });
    }
});

// 5.5. PATCH settings of a restaurant
app.patch('/api/restaurants/:id/settings', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }
    const { name, taxRate, exchangeRate, address, phone, zaadNumber, edahabNumber, premierWalletNumber, description, openingHours, receiptFooter } = req.body;

    const updateData: any = {};

    if (name !== undefined && name.trim()) updateData.name = name.trim();

    if (taxRate !== undefined) {
        if (isNaN(parseFloat(taxRate))) {
            return res.status(400).json({ error: 'taxRate must be a number' });
        }
        updateData.taxRate = parseFloat(taxRate);
    }

    if (exchangeRate !== undefined) {
        if (isNaN(parseFloat(exchangeRate))) {
            return res.status(400).json({ error: 'exchangeRate must be a number' });
        }
        updateData.exchangeRate = parseFloat(exchangeRate);
    }

    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (zaadNumber !== undefined) updateData.zaadNumber = zaadNumber;
    if (edahabNumber !== undefined) updateData.edahabNumber = edahabNumber;
    if (premierWalletNumber !== undefined) updateData.premierWalletNumber = premierWalletNumber;
    if (description !== undefined) updateData.description = description;
    if (openingHours !== undefined) updateData.openingHours = openingHours;
    if (receiptFooter !== undefined) updateData.receiptFooter = receiptFooter;

    try {
        const updated = await prisma.restaurant.update({
            where: { id },
            data: updateData,
        });
        return res.json(updated);
    } catch (error) {
        console.error('Error updating settings:', error);
        return res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ─── ORDER ROUTES ─────────────────────────────────────────────────────────────

// 2. Submit an order (public — customers place orders)
app.post('/api/orders', async (req, res) => {
    const { restaurantId, tableId, items, specialInstructions, isAddon } = req.body;

    if (!restaurantId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Invalid order input data' });
    }

    try {
        const [restaurant, table] = await Promise.all([
            prisma.restaurant.findUnique({ where: { id: restaurantId } }),
            prisma.table.findFirst({ where: { id: tableId, restaurantId } })
        ]);
        if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
        if (!table) return res.status(404).json({ error: 'Table not found for this restaurant' });

        // Retrieve items, active session, and daily order count concurrently
        const menuItemIds = items.map((item: any) => item.menuItemId);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [dbMenuItems, session, todayOrderCount] = await Promise.all([
            prisma.menuItem.findMany({ where: { id: { in: menuItemIds } } }),
            prisma.tableSession.findFirst({
                where: {
                    tableId,
                    restaurantId,
                    status: 'ACTIVE',
                    orders: {
                        some: {
                            status: { not: 'CANCELLED' }
                        }
                    }
                }
            }),
            prisma.order.count({
                where: {
                    restaurantId,
                    createdAt: { gte: todayStart }
                }
            })
        ]);

        let totalAmount = 0;
        const orderItemsData = [];

        for (const item of items) {
            const qty = parseInt(item.quantity);
            if (isNaN(qty) || qty <= 0) {
                return res.status(400).json({ error: 'Quantity must be a positive integer' });
            }

            const dbItem = dbMenuItems.find((m) => m.id === item.menuItemId);
            if (!dbItem) {
                return res.status(400).json({ error: `Menu item with ID ${item.menuItemId} not found` });
            }
            if (!dbItem.isAvailable) {
                return res.status(400).json({ error: `Menu item ${dbItem.name} is currently unavailable` });
            }
            totalAmount += dbItem.price * qty;
            orderItemsData.push({
                menuItemId: item.menuItemId,
                quantity: qty,
                priceAtOrderTime: dbItem.price // Historical price lock
            });
        }

        // Find or create an ACTIVE TableSession for this table
        let activeSession = session;
        if (!activeSession) {
            activeSession = await prisma.tableSession.create({
                data: {
                    tableId,
                    restaurantId,
                    status: 'ACTIVE',
                    totalSessionAmount: 0,
                    paymentMethod: 'UNPAID'
                }
            });
        }

        const seqNumber = todayOrderCount + 1;
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        const ddmmyy = `${day}${month}${year}`;
        const uniqueHash = Math.random().toString(36).substring(2, 6).toUpperCase();

        const customOrderId = `${seqNumber}-${ddmmyy}-${uniqueHash}`;

        // Create the Order and update Session amount in a single batch transaction
        const [order] = await prisma.$transaction([
            prisma.order.create({
                data: {
                    id: customOrderId,
                    restaurantId,
                    tableId,
                    tableSessionId: activeSession.id,
                    specialInstructions: specialInstructions || '',
                    totalAmount,
                    isAddon: !!isAddon,
                    orderItems: { create: orderItemsData },
                },
                include: {
                    table: true,
                    orderItems: { include: { menuItem: true } },
                },
            }),
            prisma.tableSession.update({
                where: { id: activeSession.id },
                data: {
                    totalSessionAmount: {
                        increment: totalAmount
                    }
                }
            })
        ]);

        io.to(restaurantId).emit('newOrder', order);
        console.log(`New Order ${order.id} sent to kitchen room: ${restaurantId} linked to Session: ${activeSession.id}`);
        return res.status(201).json(order);
    } catch (error) {
        console.error('Error creating order:', error);
        return res.status(500).json({ error: 'Failed to place order' });
    }
});

// 3. Fetch active orders for kitchen dashboard
app.get('/api/restaurants/:restaurantId/orders', verifyToken, async (req: any, res) => {
    const { restaurantId } = req.params;

    if (req.restaurant.restaurantId !== restaurantId) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const orders = await prisma.order.findMany({
            where: {
                restaurantId,
                status: { in: [OrderStatus.PENDING, OrderStatus.IN_PROGRESS, OrderStatus.READY] },
                createdAt: { gte: twentyFourHoursAgo }
            },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        return res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        return res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// 4. Update order status
app.patch('/api/orders/:orderId/status', verifyToken, async (req: any, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status || !Object.values(OrderStatus).includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: status as OrderStatus },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } },
            },
        });

        io.to(updatedOrder.restaurantId).emit('orderStatusUpdated', updatedOrder);
        console.log(`Order ${orderId} status updated to ${status}`);
        return res.json(updatedOrder);
    } catch (error) {
        console.error('Error updating order:', error);
        return res.status(500).json({ error: 'Failed to update order status' });
    }
});

// Update order payment status
app.patch('/api/orders/:orderId/payment', verifyToken, async (req: any, res) => {
    const { orderId } = req.params;
    const { paymentStatus, paymentMethod } = req.body;

    if (!paymentStatus || !['UNPAID', 'PAID'].includes(paymentStatus)) {
        return res.status(400).json({ error: 'Invalid payment status' });
    }

    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }

        // Determine payment method (enum value)
        let resolvedMethod: any = 'UNPAID';
        if (paymentStatus === 'PAID') {
            resolvedMethod = paymentMethod || 'CASH';
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { paymentStatus },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } },
            },
        });

        // Handle table session updates
        if (order.tableSessionId) {
            // Check if there are other unpaid orders in this session
            const sessionOrders = await prisma.order.findMany({
                where: {
                    tableSessionId: order.tableSessionId,
                    id: { not: orderId }
                }
            });

            const allOthersPaid = sessionOrders.every(o => o.status === 'CANCELLED' || o.paymentStatus === 'PAID');

            if (paymentStatus === 'PAID' && allOthersPaid) {
                // All orders are paid, close the session
                await prisma.tableSession.update({
                    where: { id: order.tableSessionId },
                    data: {
                        status: 'CLOSED',
                        closedAt: new Date(),
                        paymentMethod: resolvedMethod
                    }
                });
            } else if (paymentStatus === 'UNPAID') {
                // If marking unpaid, keep session active
                await prisma.tableSession.update({
                    where: { id: order.tableSessionId },
                    data: {
                        status: 'ACTIVE',
                        closedAt: null,
                        paymentMethod: 'UNPAID'
                    }
                });
            }
        }

        // Optionally emit an event to the kitchen or cashier if needed
        io.to(updatedOrder.restaurantId).emit('orderPaymentUpdated', updatedOrder);
        console.log(`Order ${orderId} payment status updated to ${paymentStatus}`);
        return res.json(updatedOrder);
    } catch (error) {
        console.error('Error updating payment status:', error);
        return res.status(500).json({ error: 'Failed to update payment status' });
    }
});

// Cancel order
app.patch('/api/orders/:orderId/cancel', async (req, res) => {
    const { orderId } = req.params;

    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'PENDING') {
            return res.status(400).json({ error: 'Order cannot be cancelled because it is already being processed.' });
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } },
            },
        });

        // Sync TableSession amount & check if session is resolved
        if (order.tableSessionId) {
            await prisma.tableSession.update({
                where: { id: order.tableSessionId },
                data: {
                    totalSessionAmount: {
                        decrement: order.totalAmount
                    }
                }
            }).catch(() => {});

            const remainingOrders = await prisma.order.findMany({
                where: {
                    tableSessionId: order.tableSessionId,
                    id: { not: orderId }
                }
            });

            const allResolved = remainingOrders.length === 0 || remainingOrders.every(o => o.status === 'CANCELLED' || o.paymentStatus === 'PAID');
            if (allResolved) {
                await prisma.tableSession.update({
                    where: { id: order.tableSessionId },
                    data: {
                        status: 'CLOSED',
                        closedAt: new Date()
                    }
                }).catch(() => {});
            }
        }

        io.to(updatedOrder.restaurantId).emit('orderCancelled', updatedOrder);
        console.log(`Order ${orderId} has been CANCELLED`);
        return res.json(updatedOrder);
    } catch (error) {
        console.error('Error cancelling order:', error);
        return res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// 7. Get Order History
app.get('/api/restaurants/:id/orders/history', verifyToken, async (req: any, res) => {
    const restId = req.restaurant.restaurantId;
    const skip = parseInt(req.query.skip as string) || 0;
    const take = parseInt(req.query.take as string) || 200;

    try {
        const orders = await prisma.order.findMany({
            where: { restaurantId: restId },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take,
        });
        return res.json(orders);
    } catch (error) {
        console.error('Error fetching order history:', error);
        return res.status(500).json({ error: 'Failed to fetch order history' });
    }
});

// Public endpoint for customers to get status of specific orders securely (by IDs or by active table session)
app.get('/api/orders/status', async (req, res) => {
    const { ids, tableId } = req.query;
    if (!ids && !tableId) return res.json([]);

    const idArray = ids && typeof ids === 'string' ? ids.split(',').filter(Boolean) : [];
    const tId = tableId && typeof tableId === 'string' ? tableId : '';

    try {
        const orConditions: any[] = [];
        if (idArray.length > 0) {
            orConditions.push({ id: { in: idArray } });
        }
        if (tId) {
            orConditions.push({
                tableId: tId,
                status: { in: ['PENDING', 'IN_PROGRESS', 'READY'] }
            });
        }

        if (orConditions.length === 0) return res.json([]);

        const orders = await prisma.order.findMany({
            where: { OR: orConditions },
            include: {
                table: true,
                orderItems: { include: { menuItem: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        return res.json(orders);
    } catch (e) {
        return res.status(500).json({ error: 'Failed to fetch order status' });
    }
});

// 7.5. Active session checker for table QR scans
app.get('/api/tables/:tableId/active-session', async (req, res) => {
    const { tableId } = req.params;
    try {
        const activeSession = await prisma.tableSession.findFirst({
            where: {
                tableId,
                status: 'ACTIVE',
                orders: {
                    some: {
                        status: { not: 'CANCELLED' }
                    }
                }
            },
            select: {
                id: true,
            },
        });
        return res.json({ hasActiveSession: !!activeSession });
    } catch (error) {
        console.error('Error checking table active session:', error);
        return res.status(500).json({ error: 'Failed to check active session.' });
    }
});

// 8. Analytics (Optimized using SQL aggregations on Neon PostgreSQL with Date Range Filtering)
app.get('/api/restaurants/:id/analytics', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    if (req.restaurant.restaurantId !== id) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    const period = (req.query.period as string) || 'today';
    const now = new Date();

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (period === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === 'yesterday') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    } else if (period === 'this_week' || period === 'last_7_days') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === 'this_month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    try {
        const whereClause: any = {
            restaurantId: id,
            paymentStatus: 'PAID',
            status: { not: 'CANCELLED' }
        };

        if (startDate) {
            whereClause.createdAt = {
                gte: startDate,
                ...(endDate ? { lte: endDate } : {})
            };
        }

        // 1. Fetch restaurant exchange rate & settings
        const restaurant = await prisma.restaurant.findUnique({
            where: { id },
            select: { exchangeRate: true, taxRate: true }
        });

        // 2. Get total paid orders for period
        const totalOrders = await prisma.order.count({
            where: whereClause
        });

        // 3. Get total revenue (sum of totalAmount for PAID orders in period)
        const revenueAggregate = await prisma.order.aggregate({
            where: whereClause,
            _sum: {
                totalAmount: true,
            },
        });
        const totalRevenue = revenueAggregate._sum.totalAmount || 0;

        // 4. Get top menu items by quantity sold in period
        const topItemsGroup = await prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: {
                order: whereClause
            },
            _sum: {
                quantity: true,
            },
            orderBy: {
                _sum: {
                    quantity: 'desc',
                },
            },
            take: 5,
        });

        const menuItemIds = topItemsGroup.map(g => g.menuItemId);
        const menuItemsDetails = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds } },
        });

        const topItems = topItemsGroup.map((item) => {
            const details = menuItemsDetails.find((d) => d.id === item.menuItemId);
            return {
                name: details?.name || 'Unknown Item',
                value: item._sum.quantity || 0,
            };
        });

        const exchangeRate = restaurant?.exchangeRate || 8500;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        return res.json({
            period,
            totalOrders,
            totalRevenue,
            averageOrderValue,
            exchangeRate,
            topItems
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        return res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// ─── CATEGORIES CRUD ──────────────────────────────────────────────────────────
app.post('/api/categories', verifyToken, async (req: any, res) => {
    const { restaurantId } = req.body;
    if (req.restaurant.restaurantId !== restaurantId) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }
    try {
        const category = await prisma.category.create({ data: req.body });
        return res.json(category);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to create category' });
    }
});
app.put('/api/categories/:id', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    try {
        const category = await prisma.category.findUnique({ where: { id } });
        if (!category) return res.status(404).json({ error: 'Category not found' });
        if (category.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }
        const updatedCategory = await prisma.category.update({ where: { id }, data: req.body });
        return res.json(updatedCategory);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to update category' });
    }
});
app.delete('/api/categories/:id', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    try {
        const category = await prisma.category.findUnique({ where: { id } });
        if (!category) return res.status(404).json({ error: 'Category not found' });
        if (category.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }
        await prisma.category.delete({ where: { id } });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to delete category' });
    }
});

// ─── MENU ITEMS CRUD ──────────────────────────────────────────────────────────
app.post('/api/menu-items', verifyToken, async (req: any, res) => {
    const { restaurantId } = req.body;
    if (req.restaurant.restaurantId !== restaurantId) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }
    try {
        const item = await prisma.menuItem.create({
            data: { ...req.body, price: parseFloat(req.body.price) },
        });
        return res.json(item);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to create menu item' });
    }
});
app.put('/api/menu-items/:id', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    try {
        const menuItem = await prisma.menuItem.findUnique({ where: { id } });
        if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
        if (menuItem.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }
        const data = { ...req.body };
        if (data.price !== undefined) data.price = parseFloat(data.price);
        const item = await prisma.menuItem.update({ where: { id }, data });
        return res.json(item);
    } catch (error) {
        return res.status(500).json({ error: 'Failed to update menu item' });
    }
});
app.delete('/api/menu-items/:id', verifyToken, async (req: any, res) => {
    const { id } = req.params;
    try {
        const menuItem = await prisma.menuItem.findUnique({ where: { id } });
        if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });
        if (menuItem.restaurantId !== req.restaurant.restaurantId) {
            return res.status(403).json({ error: 'Unauthorized access.' });
        }
        await prisma.menuItem.delete({ where: { id } });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to delete menu item' });
    }
});

// Service request HTTP API backup (Call Waiter / Request Bill)
app.post('/api/restaurants/:id/service-request', (req, res) => {
    const { id } = req.params;
    const { tableNumber, requestType } = req.body;
    if (id && tableNumber && requestType) {
        io.to(id).emit('serviceRequestAlert', { restaurantId: id, tableNumber, requestType });
        return res.json({ success: true });
    }
    return res.status(400).json({ error: 'Missing parameters' });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('joinRestaurantKitchen', (restaurantId: string) => {
        if (restaurantId) {
            socket.join(restaurantId);
            console.log(`Socket ${socket.id} joined room: ${restaurantId}`);
        }
    });

    socket.on('customerServiceRequest', (payload: { restaurantId: string, tableNumber: string, requestType: 'WAITER' | 'BILL' }) => {
        if (payload.restaurantId) {
            console.log(`Service request from table ${payload.tableNumber} in restaurant ${payload.restaurantId} for ${payload.requestType}`);
            io.to(payload.restaurantId).emit('serviceRequestAlert', payload);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function slugify(text: string) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
}

// ─── AUTOMATED SELF-HEALING & CLEANUP JOBS ──────────────────────────────────
async function runStaleOrderCleanup() {
    try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // 1. Auto-complete orders that have status READY & paymentStatus PAID created > 2 hours ago
        const autoCompleted = await prisma.order.updateMany({
            where: {
                status: 'READY',
                paymentStatus: 'PAID',
                createdAt: { lte: twoHoursAgo }
            },
            data: { status: 'COMPLETED' }
        });

        // 2. Auto-cancel orders that stayed PENDING > 24 hours ago (forgotten/abandoned)
        const autoCancelled = await prisma.order.updateMany({
            where: {
                status: 'PENDING',
                createdAt: { lte: twentyFourHoursAgo }
            },
            data: { status: 'CANCELLED' }
        });

        // 3. Auto-close stale active table sessions > 24 hours ago
        await prisma.tableSession.updateMany({
            where: {
                status: 'ACTIVE',
                openedAt: { lte: twentyFourHoursAgo }
            },
            data: {
                status: 'CLOSED',
                closedAt: new Date()
            }
        });

        if (autoCompleted.count > 0 || autoCancelled.count > 0) {
            console.log(`[Auto-Cleanup] Auto-completed ${autoCompleted.count} stale READY orders & auto-cancelled ${autoCancelled.count} abandoned PENDING orders.`);
        }
    } catch (error) {
        console.error('[Auto-Cleanup] Error running background cleanup:', error);
    }
}

// Run cleanup immediately at startup and then every 15 minutes
runStaleOrderCleanup();
setInterval(runStaleOrderCleanup, 15 * 60 * 1000);

httpServer.listen(PORT, () => {
    console.log(`QR Menu Backend running on port ${PORT}`);
});
