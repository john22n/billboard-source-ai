import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button"
import { HeaderNav } from '@/components/header-nav'

export default function Home() {
  return (
    <>
      <HeaderNav />
      <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
        <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
          <Link href="/login">
            <Button>Login</Button>
          </Link>
        </main>
        <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
          footer
        </footer>
      </div>
    </>
  );
}
