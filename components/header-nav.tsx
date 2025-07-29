import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { BrainCircuit } from "lucide-react"
import Link from 'next/link'

export function HeaderNav() {
  return (
    <header className="flex shrink-0 items-center border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <BrainCircuit className="size-4" />
            </div>
          </a>
        </div>
        <h1 className="text-base font-medium">Billboard Source AI.</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link href='/login'>
            <Button size="sm" className="sm:flex p-1">
              Login
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
