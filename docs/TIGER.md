# TIGER Address Data (Optional)

TIGER (Topologically Integrated Geographic Encoding and Referencing) is address data from the US Census Bureau. Importing it into Nominatim gives **house-number-level geocoding accuracy** — essential for rural areas where OpenStreetMap data may only resolve to a street or town.

## When to enable TIGER

- **Rural deployments** where recipients live on roads that OSM has mapped but without individual house numbers
- **Suburbs and new developments** where house numbers haven't been added to OSM yet
- **Any deployment** where address search returns the right street but not the right house

You probably **don't need TIGER** for dense urban areas where OSM has good house-number coverage.

## How to enable

In `docker/docker-compose.yml`, uncomment the TIGER import line in the Nominatim service:

```yaml
nominatim:
  environment:
    # Uncomment to import TIGER address data (adds 30-60 min to first import)
    IMPORT_TIGER_ADDRESSES: "true"
```

Then re-provision maps from the dashboard (Settings > Map Data > Re-provision).

## What it does

- Downloads US Census TIGER address range data (~2 GB)
- Imports it into Nominatim alongside the OpenStreetMap data
- Adds interpolated house numbers along street segments
- Makes address searches like "1234 Rural Route 5" resolvable

## Tradeoffs

| With TIGER | Without TIGER |
|-----------|--------------|
| House-number accuracy everywhere | House numbers only where OSM volunteers mapped them |
| +30-60 min first import | Faster first import |
| ~500 MB more disk | Less disk |
| Better for rural areas | Fine for cities |

## Pre-built TIGER data

The quarterly build pipeline at `safecare.app` pre-processes TIGER data per state. When available, the provisioning system downloads pre-built TIGER files alongside the OSRM routing data, skipping the import step.
