export function Footer() {
  return (

        <footer className="min-w-screen border-t-2 border-black text-muted-foreground px-6 py-10 bg-primary">

          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">

            {/* Column 1 */}
            <div>
              <h4 className="text-sm font-semibold text-black mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">About Us</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Careers</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Press</a></li>
              </ul>
            </div>

            {/* Column 2 */}
            <div>
              <h4 className="text-sm font-semibold text-black mb-4">Products</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Features</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Pricing</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Integrations</a></li>
              </ul>
            </div>

            {/* Column 3 */}
            <div>
              <h4 className="text-sm font-semibold text-black mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Docs</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Blog</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Support</a></li>
              </ul>
            </div>

            {/* Column 4 */}
            <div>
              <h4 className="text-sm font-semibold text-black mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Terms of Service</a></li>
                <li><a href="#" className="text-primary-foreground hover:text-black transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
          </div>

          <div className="text-center text-xs text-black mt-10">
            © {new Date().getFullYear()} Billboard Source. All rights reserved.
          </div>
          
        </footer>
  
  )
}
