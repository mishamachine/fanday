// The deletion decision for a signed-in user, with its side effects injected so scripts/test-migrations can run both paths for real
// against Postgres (pglite). Pure TypeScript, no Deno APIs.
export interface DeleteDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
  deleteAuthUser(id: string): Promise<string | null>   // error message or null
  unlinkIdentity(identityId: string): Promise<boolean>
}
export type DeleteResult =
  | { ok: true; authUserDeleted: boolean; appleUnlinked: boolean | null }
  | { ok: false; error: string }

export async function deleteAccount(userId: string, d: DeleteDeps, opts: { appleIdentityId: string | null }): Promise<DeleteResult> {
  // Decide first (read-only), then delete. Fails closed: if we cannot tell, the auth user is kept.
  const dec = await d.rpc('auth_user_deletable', { p_user: userId })
  const deletable = !dec.error && (dec.data as { deletable?: boolean } | null)?.deletable === true
  const rows = await d.rpc('delete_user_data', { p_user: userId })
  if (rows.error) return { ok: false, error: rows.error.message }
  if (deletable) {
    const err = await d.deleteAuthUser(userId)
    if (err) return { ok: false, error: err }
    return { ok: true, authUserDeleted: true, appleUnlinked: null }
  }
  // Unlink only: the Fanday rows are gone, the auth user stays (another app may use it). Remove the Apple identity Fanday added.
  const unlinked = opts.appleIdentityId ? await d.unlinkIdentity(opts.appleIdentityId).catch(() => false) : null
  return { ok: true, authUserDeleted: false, appleUnlinked: unlinked }
}
