import { getAllUsers, getUserCosts, getCurrentUser } from "@/lib/dal";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminClient from "./admin-client";
export const dynamic = 'force-dynamic'


export default async function AdminPage() {
  // Verify user is authenticated and has admin role
  const session = await getSession();
  if (!session?.userId) {
    redirect('/login');
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== 'admin') {
    redirect('/dashboard');
  }

  try {
    const users = await getAllUsers();
    const userCosts = await getUserCosts();

    return <AdminClient initialUsers={users || []} initialCosts={userCosts || []} />;
  } catch (error) {
    console.error("Failed to fetch admin data:", error);

    return <AdminClient initialUsers={[]} initialCosts={[]} />;
  }
}