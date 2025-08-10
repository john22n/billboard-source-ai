import { Button } from "@/components/ui/button"
import Image from "next/image";
import Link from 'next/link'

export function Welcome() {
  return (
    <div className="snap-y snap-mandatory h-screen overflow-scroll">
  
        <section className="relative w-full h-screen overflow-hidden snap-start flex items-center justify-center px-6 lg:px-24 xl:px-32 2xl:px-48">
  
              {/* Background Video */}
                <video
                  className="absolute inset-0 w-full h-full object-cover z-0"
                  src="/videos/sky.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                />
  
                {/* Optional: fallback image on mobile */}
                <div className="block lg:hidden md:hidden absolute inset-0 bg-primary-foreground">

                  <Image
                    src="/images/skyTwo.png"
                    alt="Blue sky with clouds"
                    fill
                    quality={100}
                    priority
                    className="w-full h-full object-cover"
                  />
                  
                </div>
  
              
             
                <div className="relative z-10 text-center max-w-4xl space-y-6">

                  <h1 className="text-5xl md:text-6xl lg:text-6xl font-extrabold tracking-tight bg-primary text-transparent bg-clip-text">
                    Welcome to Billboard Source
                  </h1>

                  <p className="text-md md:text-sm lg:text-md text-black">
                    Revolutionizing outdoor advertising with the power of artificial intelligence.
                    Find the best locations, plan smarter campaigns, and maximize your impact.
                  </p>

                  <Link href="#about">

                    <Button className="text-lg px-6 py-3 rounded-full shadow-lg hover:shadow-xl transition-all">
                      Learn More
                    </Button>

                  </Link>

                </div>
            
        </section>
  
    </div>
  )
}
