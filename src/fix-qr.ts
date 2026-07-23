import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://192.168.8.108:3000';
    const tables = await prisma.table.findMany();
    for (const t of tables) {
        const newQr = t.qrCodeData.replace(/^http:\/\/[^\/]+/, appUrl);
        await prisma.table.update({ where: { id: t.id }, data: { qrCodeData: newQr }});
    }
    console.log(`Successfully updated QR codes to use network IP: ${appUrl}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
