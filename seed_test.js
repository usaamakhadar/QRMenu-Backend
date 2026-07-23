const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    const pwd = await bcrypt.hash('password123', 10);
    const existing = await prisma.restaurant.findUnique({ where: { slug: 'somali-cuisine' } });
    if (existing) {
        console.log('Restaurant already exists!');
        return;
    }
    const rest = await prisma.restaurant.create({
        data: {
            name: 'Somali Cuisine',
            slug: 'somali-cuisine',
            email: 'admin@somalicuisine.com',
            password: pwd,
            taxRate: 0.1,
            tables: {
                create: [
                    { tableNumber: '1', qrCodeData: 'mock_qr' },
                    { tableNumber: '2', qrCodeData: 'mock_qr' }
                ]
            },
            categories: {
                create: [
                    {
                        name: 'Main Dishes',
                        menuItems: {
                            create: [
                                { name: 'Bariis iyo Hilib', description: 'Bariis basmati iyo hilib ari', price: 15.00 },
                                { name: 'Baasto iyo Suugo', description: 'Baasto suugo macaan', price: 12.00 }
                            ]
                        }
                    }
                ]
            }
        }
    });
    console.log('Created Restaurant successfully!');
}
main();
