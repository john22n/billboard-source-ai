import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button"
import { HeaderNav } from '@/components/header-nav'
import { Footer } from '@/components/Footer'
import { title } from "process";
import { Welcome } from "@/components/WelcomeSection";
import { About } from "@/components/AboutSection";
import { Product } from "@/components/ProductSection";
import { Contact } from "@/components/ContactSection";


export default function Home() {
  return (
    <>
      <main className="min-h-screen bg-primary-foreground lg:bg-primary-foreground text-black">
    
      <HeaderNav/>
      <Welcome />
      <About />
      <Product />
      <Contact />
      <Footer />

    </main>
    </>
  );
}

