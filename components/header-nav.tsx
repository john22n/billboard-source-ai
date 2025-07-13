import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { BrainCircuit } from "lucide-react"

export function HeaderNav() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b p-1">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <BrainCircuit className="size-4"/>
            </div>
          </a>
        </div>
        <h1 className="text-base font-medium">Billboard Source AI.</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="xs" className="sm:flex p-1">
            Sign in 
          </Button>
        </div>
      </div>
    </header>
  )
}
