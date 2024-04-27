import { NextResponse } from "next/server";
import { getLowestPrice, getHighestPrice, getAveragePrice, getEmailNotifType } from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

// Limit the maximum duration of the function
export const maxDuration = 1;  
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    connectToDB();

    const products = await Product.find({});

    if (!products) throw new Error("No products fetched");

    // Process each product asynchronously
    const updatedProducts = await Promise.all(
      products.map(async (currentProduct) => {
        try {
          // Scrape product details
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);
          
          if (!scrapedProduct) return;

          // Update product details
          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const product = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          // Update product in the database
          const updatedProduct = await Product.findOneAndUpdate(
            { url: product.url },
            product
          );

          // Check if email notification should be sent
          const emailNotifType = getEmailNotifType(scrapedProduct, currentProduct);

          if (emailNotifType && updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
            };

            // Construct email content
            const emailContent = await generateEmailBody(productInfo, emailNotifType);

            // Get array of user emails
            const userEmails = updatedProduct.users.map((user: any) => user.email);

            // Send email notification
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        } catch (error) {
          console.error(`Error processing product: ${error.message}`);
          return null; // Skip this product if there's an error
        }
      })
    );

    // Filter out null values (products that encountered errors)
    const filteredProducts = updatedProducts.filter(product => product !== null);

    return NextResponse.json({
      message: "Ok",
      data: filteredProducts,
    });
  } catch (error: any) {
    console.error(`Failed to get all products: ${error.message}`);
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}
