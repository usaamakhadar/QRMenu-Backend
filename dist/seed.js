"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    // Clean DB
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.menuItem.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.table.deleteMany({});
    await prisma.restaurant.deleteMany({});
    console.log('Database cleaned.');
    // Create Restaurant
    const restaurant = await prisma.restaurant.create({
        data: {
            name: 'PowerGrill',
            slug: 'powergrill',
        },
    });
    console.log(`Created Restaurant: ${restaurant.name}`);
    // Create Tables
    await prisma.table.create({
        data: {
            tableNumber: '5',
            qrCodeData: `http://localhost:3000/powergrill?table=5`,
            restaurantId: restaurant.id,
        },
    });
    await prisma.table.create({
        data: {
            tableNumber: '12',
            qrCodeData: `http://localhost:3000/powergrill?table=12`,
            restaurantId: restaurant.id,
        },
    });
    console.log(`Created Tables: 5 and 12`);
    // Create Categories
    const catGrills = await prisma.category.create({
        data: {
            name: 'Healthy Grills',
            restaurantId: restaurant.id,
        },
    });
    const catShakes = await prisma.category.create({
        data: {
            name: 'Protein Shakes',
            restaurantId: restaurant.id,
        },
    });
    const catBowls = await prisma.category.create({
        data: {
            name: 'Oats & Bowls',
            restaurantId: restaurant.id,
        },
    });
    console.log('Created Categories');
    // Create Menu Items with exact images from mockups
    await prisma.menuItem.create({
        data: {
            name: 'Grilled Fish Fillet with Veggies',
            description: 'Fresh sea bass with asparagus, lightly seasoned with lemon and herbs for a clean protein boost.',
            price: 14.90,
            imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDFO6l_anN5zo70ljfepfVzo744vaI9k3ZXh-Q5UZIxg6akYYrTS5spCc_uuKVy3pHU5X5fbsFV3_A5lLpLJpQbJasHDQdBAfYtvoBbKHt0Ywx7g4C-28Dmw4CAEkoqbdWQVIF8sIjFNs8Jf0ffjFDjqtIkFw-3FjoMOcTp60N1sg3lUfI-5lbVDgByJmSuQ2418wMFR8rK71NlMkSVBpRSHMJyWJ6lO4JOJS1i62yOpII4nzL27zsl8A',
            isAvailable: true,
            categoryId: catGrills.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'Banana Protein Smoothie',
            description: 'Creamy blend of ripe banana, vanilla whey isolate, and almond milk.',
            price: 8.50,
            imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBxuUcJIiHv_MCXbVabe2hCbcLqeY4kGYdS3daNzOxxM9GU61flMKcLLWOIQ4H29MGOMrPZCAm1x2Jy7othU6GRXxkn422KKFnz91CVJZPbdVeLsNaHgeZzmFLVHc8srTvDdr8l-H83q99MCoLJL962-WaBnpYk6SuQe8vQ0MNtn0oGJ1eLf-nb6xMLMxL_0NQFVhrN9N01FB8EjwkiTWXyqHCOllwwmrzD3fcnDhjH4vfsu9Z-1IBoxw',
            isAvailable: true,
            categoryId: catShakes.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'Oatmeal & Peanut Butter Power Bowl',
            description: 'High-fiber energy bowl topped with chia seeds, fresh berries, and raw honey.',
            price: 9.00,
            imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCPIQsvYfgdhI01SN5KIIC6CfC6O61Vcge2F2INE0ksXrfmv4cu-NAgHOqrI6zTZBah8AYI-s8N8sNoq8Ts7asrLfhjdTiJbQjMpbaS6oCwIu5pwWymoKFuPik9yxZabdHbw9gfsWWcOH8oWq2kUn1uIsSGQmyg5L634DGSjRo4jZ_6T9QYamhPPBCNY-rmZkv8gsZ3Vvyf2gPoApJBveDV6rbd8l0Tr3CYZfqj7VdxjsODm2-fzVp92Q',
            isAvailable: true,
            categoryId: catBowls.id,
            restaurantId: restaurant.id,
        },
    });
    // Additional items
    await prisma.menuItem.create({
        data: {
            name: 'Spicy Tuna Roll',
            description: 'Fresh tuna, spicy mayo, cucumber, seasoned rice rolled in nori.',
            price: 12.50,
            imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBkTJIV6Fa3vZmChP-EE9imfeS9pq5kLDQTuITr_ACUbJ8iESYB43rFc9EXsbN4n9pMRgEERGBZKO4mNwS58YGfI607UR8GIOFVs4anTJNh9IGEgGTe_UEo8kA-NuHiyh4vwdMrBmfPZcIOJpfpkO5CQ_zlJ1yIIzk2ZgG40VuNa5uzwZzecHH3CY-qKQByFblzaSlWjzWhP9d44iiHAro80FuZlSkYm7mNR_kIYPIxiKcusvIYxoxFcQ',
            isAvailable: true,
            categoryId: catGrills.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'Classic Burger',
            description: 'Gourmet beef patty, fresh lettuce, tomato, house sauce.',
            price: 10.99,
            isAvailable: true,
            categoryId: catGrills.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'Fries',
            description: 'Golden crispy potato fries.',
            price: 4.50,
            isAvailable: true,
            categoryId: catGrills.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'Steak Frites',
            description: 'Premium grilled steak served with fries and herb butter.',
            price: 24.50,
            isAvailable: true,
            categoryId: catGrills.id,
            restaurantId: restaurant.id,
        },
    });
    await prisma.menuItem.create({
        data: {
            name: 'House Salad',
            description: 'Mixed greens with cherry tomatoes, cucumbers, balsamic vinaigrette.',
            price: 7.99,
            isAvailable: true,
            categoryId: catBowls.id,
            restaurantId: restaurant.id,
        },
    });
    console.log('Created Menu Items and completed seeding!');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
