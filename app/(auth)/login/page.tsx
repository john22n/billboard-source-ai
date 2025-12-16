import { LoginForm } from "@/components/login-form"
import dynamic from "next/dynamic"

// Lazy-load Spline 3D viewer - it's heavy and not needed for initial render
const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 animate-pulse" />
  ),
})

export default function LoginPage() {
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
