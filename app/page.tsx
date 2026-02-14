'use client'

import { LoginForm } from "@/components/login-form"
import Spline from "@splinetool/react-spline"



export default function Home() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2 bg-primary-foreground">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm />
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <Spline scene="https://prod.spline.design/1eapv4LnOygEqB66/scene.splinecode" />
      </div>
    </div>
  )
}
