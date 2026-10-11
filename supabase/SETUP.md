# Turning on "Sign in with Google"

About 10 minutes. You need a Google account and a free Supabase account.
Nothing here costs money.

## 1. Create the Supabase project

1. Go to https://supabase.com and sign in (signing in with GitHub is fine).
2. Click **New project**.
   - Name: `sve-tracker`
   - Database password: click **Generate a password** and save it in your password manager (the site never needs it).
   - Region: **Central EU (Frankfurt)**
3. Wait a minute or two for the project to start.

## 2. Create the table

1. In the left menu open **SQL Editor**, then **New query**.
2. Paste the whole contents of `supabase/schema.sql` from this repo and click **Run**.
3. It should say "Success. No rows returned".

## 3. Create the Google login key

1. Go to https://console.cloud.google.com and create a new project called `sve-tracker`.
2. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**). Click **Get started**:
   - App name: `SVE Fish Log`
   - User support email and developer contact: your email
   - Audience: **External**
3. Under **Branding → Authorized domains**, add `supabase.co` and `oliverpuskai-cloud.github.io`.
4. Under **Audience**, click **Publish app** so anyone can sign in, not only test users.
   The site only asks for name and email, so Google doesn't need to review it.
5. Open **Clients** (or **Credentials**) → **Create client** → **Web application**.
   - Name: `SVE Fish Log`
   - **Authorized JavaScript origins**: `https://oliverpuskai-cloud.github.io` and `http://localhost:4330`
   - **Authorized redirect URIs**: the callback URL from Supabase. Find it in Supabase under
     **Authentication → Sign In / Providers → Google** ("Callback URL (for OAuth)").
     It looks like `https://abcdefgh.supabase.co/auth/v1/callback`.
6. Click **Create**. Google shows a **Client ID** and a **Client secret**.

## 4. Connect Google to Supabase

1. In Supabase open **Authentication → Sign In / Providers → Google**.
2. Turn it on, paste the **Client ID** and **Client secret**, and click **Save**.
   The secret only goes here, never into the website's code.
3. Open **Authentication → URL Configuration**:
   - Site URL: `https://oliverpuskai-cloud.github.io/sve-tracker/`
   - Redirect URLs: add `https://oliverpuskai-cloud.github.io/sve-tracker/` and `http://localhost:4330/`

## 5. Put the public keys in the site

1. In Supabase open **Project Settings → API Keys** (or **Data API**).
2. Copy the **Project URL** and the **anon / publishable key**.
   Both are meant to be public. Row Level Security (the policies in `schema.sql`) is what keeps each player's data private.
3. Paste them into `js/config.js`:

```js
export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

Never put the **service_role** / secret key or the Google client secret in the site.
