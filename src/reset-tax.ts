import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    await prisma.restaurant.updateMany({
        data: { taxRate: 0.0 }
    });
    console.log('Successfully reset taxRate = 0.0 for all restaurants in database.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
