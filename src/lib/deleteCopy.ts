// What "Delete account" does, in words. The same sentences are on the website (site/src/delete.html) and in the privacy policy
// (section 8); scripts/test-delete-copy.mjs fails if they drift apart.
export const DELETE_SIGNED_IN =
  'This deletes all your Fanday data from our database. If you created your sign-in through Fanday and none of our other apps holds data for you, we delete the sign-in too. Otherwise the sign-in stays, because our other apps use it; you can delete it from those apps. If you signed in with Apple, we also tell Apple to disconnect Fanday.'
export const DELETE_SIGNED_OUT = 'This deletes everything linked to this device from our database and stops its device code working.'
