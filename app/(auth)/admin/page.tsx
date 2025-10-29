import { getAllUsers, getUserCosts } from "@/lib/dal";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  try {
   
    const users = await getAllUsers();
    const userCosts = await getUserCosts();

    return <AdminClient initialUsers={users || []} initialCosts={userCosts || []} />;
  } catch (error) {
    console.error("Failed to fetch admin data:", error);
    
    return <AdminClient initialUsers={[]} initialCosts={[]} />;
  }
}