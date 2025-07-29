'use client'
import { GalleryVerticalEnd } from "lucide-react"
import { SignupForm } from "@/components/sign-up"
import Spline from "@splinetool/react-spline"

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <SignupForm />
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        user table TODO: create table of users already create perform actions such as delete
      </div>
    </div>
  )
}
