CREATE OR REPLACE FUNCTION get_distinct_months()
RETURNS TABLE(month integer, year integer)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT month, year
  FROM monthly_inventory
  ORDER BY year, month;
$$;;
