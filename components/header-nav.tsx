import { Button } from "@/components/ui/button"
import { BrainCircuit } from "lucide-react"
import Link from 'next/link'

export function HeaderNav() {
  return (
  <header className="min-w-screen flex items-center justify-between bg-primary px-4 py-4 border-b border-black">

    <div className="flex w-full items-center justify-between">

      <a href="#" className=" group flex items-center gap-2 font-medium">
        <div className="bg-primary-foreground text-black group-hover:bg-black group-hover:text-primary-foreground flex size-6 items-center justify-center rounded-md">
          <BrainCircuit className="size-4"/>
        </div>
        <div className="group text-md font-bold tracking-tight text-black group-hover:text-primary-foreground">Billboard Source AI</div>
      </a>

      <nav className="hidden md:flex mr-20 font-sm gap-15 bg-black py-1 px-5 rounded-4xl">
          <a href="#about" className="text-gray-500 hover:text-primary-foreground transition-colors">
            About
          </a>
          <a href="#products" className="text-gray-500 hover:text-primary-foreground transition-colors">
            Products
          </a>
          <a href="#contact" className="text-gray-500 hover:text-primary-foreground transition-colors">
            Contact
          </a>
      </nav>

        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button size="sm" className="bg-primary-foreground text-black px-4 py-2 hover:bg-black hover:text-primary-foreground border-2 border-primary-foreground">
          Login
            </Button>
          </Link> 
        </div>

    </div>
    
    

  </header>
  )
}
