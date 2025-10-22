// app/admin/page.tsx
import { getAllUsers, getUserCosts } from "@/lib/dal";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  try {
    // Fetch data directly in the Server Component
    const users = await getAllUsers();
    const userCosts = await getUserCosts();

    // Pass data to Client Component
    return <AdminClient initialUsers={users || []} initialCosts={userCosts || []} />;
  } catch (error) {
    console.error("Failed to fetch admin data:", error);
    
    // Return client with empty arrays on error
    return <AdminClient initialUsers={[]} initialCosts={[]} />;
  }
}