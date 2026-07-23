import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        include: { restaurant: true }
    });
    console.log('--- USERS IN DATABASE ---');
    users.forEach(u => {
        console.log(`Email: ${u.email} | Name: ${u.name} | Role: ${u.role} | Restaurant: ${u.restaurant?.name || 'N/A'} (ID: ${u.restaurantId})`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
