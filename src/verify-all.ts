import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const restaurants = await prisma.restaurant.findMany();
    console.log('=== ALL RESTAURANTS STANDARDIZATION CHECK ===');
    restaurants.forEach(r => {
        console.log(`Restaurant: ${r.name} | Slug: ${r.slug} | TaxRate: ${r.taxRate} | ExchangeRate: ${r.exchangeRate}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
