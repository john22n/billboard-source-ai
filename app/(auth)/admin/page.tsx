import { getAllUsers, getUserCosts, getCurrentUser } from "@/lib/dal";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminClient from "./admin-client";

// Enable static generation for the shell, with dynamic data
export const dynamic = 'force-dynamic';

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

  // Fetch users and costs in parallel for better performance
  const [users, userCosts] = await Promise.all([
    getAllUsers(),
    getUserCosts(),
  ]);

  return <AdminClient initialUsers={users || []} initialCosts={userCosts || []} />;
}