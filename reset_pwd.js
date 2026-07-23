const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    const email = '9onecafe@resturant.com';
    const newPassword = await bcrypt.hash('123456', 12);
    
    await prisma.restaurant.update({
        where: { email },
        data: { password: newPassword }
    });
    console.log(`Password reset successfully for ${email}`);
}
main();
