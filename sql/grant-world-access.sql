CREATE OR REPLACE FUNCTION public.grant_world_access(p_world_id uuid, p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT password_hash INTO v_hash
  FROM worlds
  WHERE id = p_world_id;

  -- No password set = always grant
  IF v_hash IS NULL THEN
    RETURN true;
  END IF;

  -- Wrong password
  IF crypt(p_password, v_hash) <> v_hash THEN
    RETURN false;
  END IF;

  -- Correct — upsert access row
  INSERT INTO world_access (user_id, world_id)
  VALUES (auth.uid(), p_world_id)
  ON CONFLICT (user_id, world_id) DO NOTHING;

  RETURN true;
END;
$$;
