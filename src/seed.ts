import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    await prisma.user.deleteMany({});
    await prisma.tableSession.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.menuItem.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.table.deleteMany({});
    await prisma.restaurant.deleteMany({});

    const hashedPassword = await bcrypt.hash('demo1234', 12);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const createRest = async (name: string, slug: string, desc: string, hours: string, email: string, itemsRaw: any[]) => {
        const res = await prisma.restaurant.create({
            data: { name, slug, description: desc, openingHours: hours },
        });
        await prisma.user.create({
            data: { name: name + ' Admin', email, password: hashedPassword, role: 'OWNER', restaurantId: res.id },
        });
        for (let i = 1; i <= 4; i++) {
            await prisma.table.create({
                data: { tableNumber: String(i), qrCodeData: `${appUrl}/${slug}?table=${i}`, restaurantId: res.id },
            });
        }
        
        for (const cat of itemsRaw) {
            const category = await prisma.category.create({ data: { name: cat.cat, restaurantId: res.id } });
            for (const itemName of cat.items) {
                // Determine generic image based on category
                let imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg';
                const lower = cat.cat.toLowerCase();
                if (lower.includes('coffee') || lower.includes('tea')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG';
                else if (lower.includes('pastry') || lower.includes('bakery') || lower.includes('dessert') || lower.includes('sweet')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Croissant%2C_cross_section.jpg';
                else if (lower.includes('sandwich') || lower.includes('burger')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/4/47/Hamburger_%28black_bg%29.jpg';
                else if (lower.includes('salad') || lower.includes('side') || lower.includes('appetizer') || lower.includes('soup')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/9/94/Salad_platter.jpg';
                else if (lower.includes('shake') || lower.includes('juice') || lower.includes('drink')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/3/3b/Glass_of_orange_juice.jpg';
                else if (lower.includes('grill') || lower.includes('kebab') || lower.includes('rice') || lower.includes('pasta')) imgUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a3/Eqraft_-_Shish_kebab.jpg';

                await prisma.menuItem.create({
                    data: {
                        name: itemName, 
                        description: 'Freshly prepared ' + itemName + ' with high quality ingredients.', 
                        price: Math.floor(Math.random() * 10) + 4.99, 
                        imageUrl: imgUrl,
                        isAvailable: true, 
                        categoryId: category.id, 
                        restaurantId: res.id
                    }
                });
            }
        }
    };
    
    await createRest('Saba Cafe', 'sabacafe', 'Premium Coffee and Pastries', '7:00 AM - 11:00 PM', 'owner@sabacafe.com', [{"cat":"Coffee & Tea","items":["Espresso Single","Double Espresso","Classic Cappuccino","Cafe Latte","Iced Caramel Macchiato","Turkish Coffee","Somali Spiced Tea","Americano","Flat White","Mocha"]},{"cat":"Pastries & Bakery","items":["Butter Croissant","Chocolate Croissant","Almond Pastry","Cinnamon Roll","Blueberry Muffin"]},{"cat":"Sandwiches & Pasta","items":["Avocado Toast","Turkey Club Sandwich","Smoked Salmon Bagel","Grilled Cheese Sandwich","Chicken Caesar Wrap"]},{"cat":"Salads & Sides","items":["Classic Greek Salad","Chicken Caesar Salad","Quinoa Bowl","Sweet Potato Fries","Onion Rings"]},{"cat":"Desserts","items":["Chocolate Fudge Cake","New York Cheesecake","Tiramisu Cup","Ice Cream Waffle","Pancakes with Syrup"]}]);
    await createRest('Burger House', 'burgerhouse', 'Gourmet Burgers and Shakes', '11:00 AM - 12:00 AM', 'owner@burgerhouse.com', [{"cat":"Gourmet Burgers","items":["Classic Cheeseburger","Double Bacon Burger","Mushroom Swiss Burger","Spicy Zinger Burger","BBQ Pulled Beef Burger","Avocado Turkey Burger","Crispy Fish Burger","Vegan Garden Burger","Truffle Aioli Burger","Hawaiian Teriyaki Burger","Blue Cheese Burger","Tex-Mex Jalapeno Burger"]},{"cat":"Sides & Starters","items":["Classic French Fries","Loaded Chili Cheese Fries","Mozzarella Cheese Sticks","Buffalo Chicken Wings","Honey BBQ Wings","Crispy Onion Rings","Garlic Parmesan Bread","Coleslaw Salad"]},{"cat":"Thick Milkshakes","items":["Vanilla Bean Milkshake","Double Chocolate Milkshake","Strawberry Cream Shake","Oreo Cookies Shake","Mango Passion Smoothie","Fresh Mint Lemonade"]},{"cat":"Desserts","items":["Chocolate Lava Cake","Warm Apple Pie","Hot Brownie Sundae","Banana Split"]}]);
    await createRest('Spice Grill', 'spicegrill', 'Authentic Somali and Grills', '12:00 PM - 11:30 PM', 'owner@spicegrill.com', [{"cat":"Appetizers & Soups","items":["Beef Sambusa (3pcs)","Lentil Sambusa (3pcs)","Creamy Lentil Soup","Hummus with Pita","Tabbouleh Salad","Fattoush Salad"]},{"cat":"Char Grills & Kebabs","items":["Chicken Tikka Kebabs","Beef Kofta Kebabs","Grilled Lamb Chops","Mixed Grill Platter","Half Char-Grilled Chicken","Fish Tikka","Shish Taouk","Adana Kebab","Mutton Seekh Kebab","Grilled Prawns"]},{"cat":"Rice & Main Entrees","items":["Somali Bariis & Hilib","Lamb Biryani Rice","Chicken Mandi Rice","Beef Shawarma Wrap","Chicken Shawarma Wrap","Butter Chicken with Naan"]},{"cat":"Local Juices","items":["Fresh Avocado Shake","Fresh Mango Juice","Iced Vimto Drink","Somali Cardamon Tea"]},{"cat":"Oriental Desserts","items":["Premium Baklava","Kunafa with Cheese","Basbousa Cake","Cardamom Rice Pudding"]}]);

    console.log('Successfully completed database seeding for all 3 restaurants!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
