# Use a terminal overflow number after two call attempts

Inbound calls will receive up to two Sales Rep Call Attempts using the existing routing eligibility rules, then route to a configured Overflow Number instead of Billboard Source AI voicemail. The Overflow Number is terminal: the application does not enforce an overflow ring window or route the caller to its voicemail flow, because the business wants the overflow destination to own the final call handling.
