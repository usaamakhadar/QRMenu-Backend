"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: '*', // Adjust to specific frontend domain in production
        methods: ['GET', 'POST', 'PATCH'],
    },
});
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Log requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
// REST API ROUTES
// 1. Get restaurant details by slug (categories, menuItems, tables)
app.get('/api/restaurants/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { slug },
            include: {
                categories: true,
                menuItems: {
                    where: { isAvailable: true },
                    include: { category: true },
                },
                tables: true,
            },
        });
        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        return res.json(restaurant);
    }
    catch (error) {
        console.error('Error fetching restaurant:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});
// 2. Submit an order
app.post('/api/orders', async (req, res) => {
    const { restaurantId, tableId, items, specialInstructions } = req.body;
    if (!restaurantId || !tableId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Invalid order input data' });
    }
    try {
        // 1. Verify restaurant and table
        const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
        if (!restaurant)
            return res.status(404).json({ error: 'Restaurant not found' });
        const table = await prisma.table.findFirst({
            where: { id: tableId, restaurantId },
        });
        if (!table)
            return res.status(404).json({ error: 'Table not found for this restaurant' });
        // 2. Fetch Menu Items to calculate total price securely on the server
        const menuItemIds = items.map((item) => item.menuItemId);
        const dbMenuItems = await prisma.menuItem.findMany({
            where: { id: { in: menuItemIds } },
        });
        let totalAmount = 0;
        const orderItemsData = [];
        for (const item of items) {
            const dbItem = dbMenuItems.find((m) => m.id === item.menuItemId);
            if (!dbItem) {
                return res.status(400).json({ error: `Menu item with ID ${item.menuItemId} not found` });
            }
            totalAmount += dbItem.price * item.quantity;
            orderItemsData.push({
                menuItemId: item.menuItemId,
                quantity: item.quantity,
            });
        }
        // 3. Create the order inside a prisma transaction
        const order = await prisma.order.create({
            data: {
                restaurantId,
                tableId,
                specialInstructions: specialInstructions || '',
                totalAmount,
                orderItems: {
                    create: orderItemsData,
                },
            },
            include: {
                table: true,
                orderItems: {
                    include: {
                        menuItem: true,
                    },
                },
            },
        });
        // 4. Emit socket event only to the restaurant's kitchen room
        io.to(restaurantId).emit('newOrder', order);
        console.log(`New Order ${order.id} sent to kitchen room: ${restaurantId}`);
        return res.status(201).json(order);
    }
    catch (error) {
        console.error('Error creating order:', error);
        return res.status(500).json({ error: 'Failed to place order' });
    }
});
// 3. Fetch active orders for a restaurant (for kitchen dashboard)
app.get('/api/restaurants/:restaurantId/orders', async (req, res) => {
    const { restaurantId } = req.params;
    try {
        const orders = await prisma.order.findMany({
            where: {
                restaurantId,
                status: {
                    in: [client_1.OrderStatus.PENDING, client_1.OrderStatus.IN_PROGRESS, client_1.OrderStatus.READY],
                },
            },
            include: {
                table: true,
                orderItems: {
                    include: {
                        menuItem: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
        });
        return res.json(orders);
    }
    catch (error) {
        console.error('Error fetching orders:', error);
        return res.status(500).json({ error: 'Failed to fetch orders' });
    }
});
// 4. Update order status
app.patch('/api/orders/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    if (!status || !Object.values(client_1.OrderStatus).includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    try {
        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: status },
            include: {
                table: true,
                orderItems: {
                    include: {
                        menuItem: true,
                    },
                },
            },
        });
        // Emit live update to restaurant kitchen floor
        io.to(updatedOrder.restaurantId).emit('orderStatusUpdated', updatedOrder);
        console.log(`Order ${orderId} status updated to ${status}`);
        return res.json(updatedOrder);
    }
    catch (error) {
        console.error('Error updating order:', error);
        return res.status(500).json({ error: 'Failed to update order status' });
    }
});
// SOCKET.IO REAL-TIME COMMUNICATION
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    // Kitchen dashboard or customer joins their restaurant room
    socket.on('joinRestaurantKitchen', (restaurantId) => {
        if (restaurantId) {
            socket.join(restaurantId);
            console.log(`Socket ${socket.id} joined room: ${restaurantId}`);
        }
    });
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});
httpServer.listen(PORT, () => {
    console.log(`QR Menu Backend running on port ${PORT}`);
});
