import Image from "next/image";


export function Product() {
  return (
        <section id="products" className="min-h-screen bg-primary-foreground text-center py-12 px-4">

            <div className="max-w-7xl mx-auto">

              <h2 className="text-3xl md:text-5xl font-extrabold text-black mb-10 tracking-wide">
                Products
              </h2>
  
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
                {[
                  {
                    title: "Billboards",
                    image: "/images/products/billboardTwo.jpeg",
                    description: "Large-scale outdoor ads for highways and high-traffic areas.",
                  },
                  {
                    title: "Posters",
                    image: "/images/products/posters.jpeg",
                    description: "Smaller format billboards ideal for urban areas.",
                  },
                  {
                    title: "Jr. Posters",
                    image: "/images/products/JrPoster.jpeg",
                    description: "Compact and affordable options for local promotions.",
                  },
                  {
                    title: "Mobile Billboards",
                    image: "/images/products/mobileBillboard.jpeg",
                    description: "Ads mounted on moving vehicles for dynamic exposure.",
                  },
                  {
                    title: "Premiere Panel",
                    image: "/images/products/PremierePanel.jpeg",
                    description: "High-profile placements with premium visibility.",
                  },
                  {
                    title: "Mall Displays",
                    image: "/images/products/MallDisplay.jpeg",
                    description: "Indoor ads located inside shopping malls and retail centers.",
                  },
                  {
                    title: "Airport Displays",
                    image: "/images/products/AirportDisplay.jpeg",
                    description: "Targeted ads for high-income and travel audiences.",
                  },
                  {
                    title: "Commuter Rail Displays",
                    image: "/images/products/commuterRailDisplay.jpeg",
                    description: "Reach daily commuters with strategic rail placements.",
                  },
                  {
                    title: "Wallscapes",
                    image: "/images/products/wallscapes.jpeg",
                    description: "Massive custom ads painted or mounted on buildings.",
                  },
                ].map((product, idx) => (
                    
                  <div key={idx} className="rounded-2xl p-5 shadow-xl border border-black">

                    <Image
                      src={product.image}
                      alt={product.title}
                      width={400}
                      height={200}
                      className="w-full h-40 object-cover rounded-xl border border-black mb-4"
                    />

                    <h3 className="text-lg md:text-xl font-semibold text-black mb-2">
                      {product.title}
                    </h3>

                    <p className="text-sm text-muted-foreground">{product.description}</p>

                  </div>

                ))}
  
                {/* FINAL CENTERED CARD */}
                <div className="col-span-full flex justify-center">

                  <div className="w-full h-full md:w-60 md:h-44 lg:w-100 lg:h-55  border-1 border-black flex items-center justify-center rounded-2xl shadow-xl">

                    <span className="text-xl md:text-2xl font-bold text-black">And More</span>

                  </div>

                </div>

              </div>

            </div>

        </section>
  )
}
