import { Button } from "@/components/ui/button"


export function Contact() {
  return (
        <section id="contact" className="min-h-screen flex items-center justify-center px-6 py-10 bg-primary-foreground">

            <div className="max-w-xl w-full text-center space-y-6">

              <h2 className="text-4xl font-bold text-primary">Get in Touch</h2>
              
              <p className="text-gray-600 text-base sm:text-lg">
                Have questions or want to learn more? We'd love to hear from you.
              </p>
              
              <div className="text-lg text-gray-800">
                📞 1-800-609-5259
              </div>

              <a href="mailto:info@billboardsource.ai" className="inline-block">
              
                <Button className="rounded-full px-6 py-2 text-white">
                  Contact via Email
                </Button>

              </a>

            </div>

          </section>
  )
}