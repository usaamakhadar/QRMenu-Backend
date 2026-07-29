import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://qrmenu-digital.vercel.app';
    const tables = await prisma.table.findMany();
    for (const t of tables) {
        const newQr = t.qrCodeData.replace(/^https?:\/\/[^\/]+/, appUrl);
        await prisma.table.update({ where: { id: t.id }, data: { qrCodeData: newQr }});
    }
    console.log(`Successfully updated QR codes to: ${appUrl}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
