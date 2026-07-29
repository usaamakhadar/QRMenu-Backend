import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    await prisma.restaurant.updateMany({
        data: { exchangeRate: 8500.0 }
    });
    console.log('Successfully updated exchangeRate = 8500.0 for all restaurants in database.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
