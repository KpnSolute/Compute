
-- Remove orphan test accounts (no user_profiles, no business purpose)
DELETE FROM auth.users WHERE id = '867ff221-256c-48c9-bc3a-0efaa897ee59'; -- test123@example.com
DELETE FROM auth.users WHERE id = '687c3b5b-9038-4974-aa44-d3bd83e4fd8f'; -- newuser@mjc-cafeteria.com

-- Remove the broken @mjc-cafeteria.com originals for developer and accountant
-- (these cause GoTrue 500 errors — likely corrupted during bulk creation)
DELETE FROM auth.users WHERE id = '9247a11f-6529-4fbf-802d-a8ec28d8f0c2'; -- developer@mjc-cafeteria.com
DELETE FROM auth.users WHERE id = 'f040c512-90d4-4636-b0a4-d25130013749'; -- accountant@mjc-cafeteria.com

-- Update the working @mjc.local accounts to use @mjc-cafeteria.com emails
-- so everything is on one consistent domain
UPDATE auth.users 
SET email = 'developer@mjc-cafeteria.com',
    updated_at = NOW()
WHERE id = 'ad67b269-0f3c-4d4a-82cd-b798f989e087'; -- developer@mjc.local

UPDATE auth.users 
SET email = 'accountant@mjc-cafeteria.com',
    updated_at = NOW()
WHERE id = '4fd1d279-b9b6-45df-a2de-ca57117894b5'; -- accountant@mjc.local

-- Update user_profiles to point to the new correct UUIDs
UPDATE public.user_profiles
SET id = 'ad67b269-0f3c-4d4a-82cd-b798f989e087'
WHERE username = 'developer';

UPDATE public.user_profiles
SET id = '4fd1d279-b9b6-45df-a2de-ca57117894b5'
WHERE username = 'accountant';
;
