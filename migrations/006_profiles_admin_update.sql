-- Allow admins to update any user's profile (needed for granting CP access)
DROP POLICY IF EXISTS "Admins update any profile" ON profiles;
CREATE POLICY "Admins update any profile"
  ON profiles FOR UPDATE
  USING ((SELECT is_admin FROM profiles p2 WHERE p2.user_id = auth.uid()) = true);
