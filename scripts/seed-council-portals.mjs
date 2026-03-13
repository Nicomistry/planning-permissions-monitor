/**
 * seed-council-portals.mjs
 * ─────────────────────────────────────────────────────────────────
 * Fetches all UK Local Planning Authorities from planning.data.gov.uk,
 * detects portal software type from URL patterns, and inserts rows
 * into the Supabase `council_portal_configs` table.
 *
 * Run:
 *   node scripts/seed-council-portals.mjs
 *
 * Requires .env (or env vars):
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY=eyJ...   ← service_role key (not anon)
 * ─────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load .env manually (no dotenv dependency needed) ─────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../.env');
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && !k.startsWith('#')) process.env[k] = v.join('=');
  });
} catch (_) { /* no .env file, rely on process env */ }

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('✗ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Region mapping (mirrors admin.html COUNCIL_REGION) ────────────
const REGION_MAP = {
  'London':     ['Barking and Dagenham','Barnet','Bexley','Brent','Bromley','Camden','City','Croydon','Ealing','Enfield','Greenwich','Hackney','Hammersmith and Fulham','Haringey','Harrow','Havering','Hillingdon','Hounslow','Islington','Kensington','Kingston','Lambeth','Lewisham','Merton','Newham','Old Oak Park Royal','Redbridge','Richmond','Southwark','Sutton','Tower Hamlets','Waltham Forest','Wandsworth','Westminster'],
  'South East': ['Adur and Worthing','Arun','Ashford','Basingstoke','Bracknell','Brighton','Canterbury','Castle Point','Chelmsford','Chichester','Crawley','Dartford','Dover','Eastbourne','Eastleigh','Elmbridge','Epsom and Ewell','Epping Forest','Fareham','Gosport','Gravesham','Guildford','Hampshire','Hart','Hastings','Havant','Hertfordshire','Hertsmere','Horsham','Isle of Wight','Kent','Lewes','Medway','Mid Kent','Mid Sussex','Mole Valley','New Forest (District)','New Forest (Park)','Oxford','Oxfordshire','Reading','Reigate','Rother','Rushmoor','Sevenoaks','Shepway','Slough','South Downs','South Oxfordshire','Spelthorne','St Albans','Surrey','Surrey Heath','Tandridge','Test Valley','Thanet','Three Rivers','Tonbridge','Tunbridge Wells','Vale of White Horse','Waverley','Wealden','Welwyn Hatfield','West Berkshire','West Oxfordshire','Windsor','Woking','Wokingham'],
  'South West': ['Bath','BCP','Bristol','Cheltenham','Cornwall','Cotswold','Dartmoor','Devon','Dorset','East Devon','Exmoor','Gloucester','Gloucestershire','Mid Devon','North Devon','North Somerset','Plymouth','Scilly Isles','Sedgemoor','Somerset','South Gloucestershire','South Somerset','South West Devon','Stroud','Swindon','Taunton Deane','Tewkesbury','Torbay','Torridge','West Somerset','Wiltshire'],
  'East':       ['Bedford','Braintree','Breckland','Cambridge','Cambridgeshire','Central Bedfordshire','Colchester','East Cambridgeshire','East Suffolk','Essex','Fenland','Great Yarmouth','Huntingdonshire','Ipswich','Kings Lynn','Luton','Maldon','Norfolk','North Hertfordshire','Norwich','Peterborough','South Cambridgeshire','South Norfolk Broadland','Suffolk','Tendring','Thurrock','Uttlesford','Watford','West Suffolk'],
  'Midlands':   ['Amber Valley','Blaby','Bolsover','Boston','Birmingham','Bromsgrove Redditch','Cannock Chase','Charnwood','Chesterfield','Coventry','Derby','Derbyshire','Derbyshire Dales','Dudley','East Staffordshire','Erewash','Gedling','Herefordshire','High Peak','Hinckley and Bosworth','Leicester','Leicestershire','Lichfield','Lincoln','Lincolnshire','Malvern Hills','Mansfield','Melton','Newark and Sherwood','Newcastle under Lyme','North East Derbyshire','North Kesteven','North Warwickshire','North West Leicestershire','Nottingham','Nottinghamshire','Oadby and Wigston','Peak District','Rushcliffe','Rutland','Sandwell','Shropshire','Solihull','South Derbyshire','South Holland','South Kesteven','South Staffordshire','Stafford','Staffordshire','Staffordshire Moorlands','Stoke on Trent','Stratford on Avon','Tamworth','Telford','Walsall','Warwick','Warwickshire','West Lindsey','Wolverhampton','Worcester','Worcestershire','Wychavon','Wyre Forest'],
  'North':      ['Barnsley','Blackburn','Blackpool','Bradford','Burnley','Bury','Calderdale','Carlisle','Chester','Cheshire East','Chorley','Craven','Cumbria','Darlington','Doncaster','Durham','East Riding','Fylde','Gateshead','Hambleton','Harrogate','Hartlepool','Hull','Hyndburn','Kirklees','Lancaster','Leeds','Liverpool','Manchester','Middlesbrough','Newcastle upon Tyne','North Tyneside','North Yorkshire','North York Moors','Northumberland (County)','Northumberland (Park)','Oldham','Pendle','Preston','Redcar and Cleveland','Ribble Valley','Richmondshire','Rochdale','Rossendale','Rotherham','Ryedale','Salford','Scarborough','Sefton','Selby','Sheffield','South Ribble','South Tyneside','St Helens','Stockport','Stockton-on-Tees','Sunderland','Tameside','Trafford','Wakefield','Warrington','West Lancashire','Wigan','Wirral','Wyre','York','Yorkshire Dales'],
  'Wales':      ['Blaenau Gwent','Bridgend','Brecon Beacons','Caerphilly','Cardiff','Carmarthenshire','Ceredigion','Conwy','Denbighshire','DNS Wales','Flintshire','Glamorgan','Gwynedd','Monmouthshire','Neath','Newport','NSIP Wales','Pembroke Coast','Pembrokeshire','Powys','Rhondda','Snowdonia','Swansea','Torfaen','Wrexham'],
  'Scotland':   ['Aberdeen','Aberdeenshire','Angus','Argyll','Cairngorms','Clackmannanshire','Dumfries','Dundee','East Ayrshire','East Dunbartonshire','East Lothian','East Renfrewshire','Edinburgh','Falkirk','Fife','Glasgow','Highland','Inverclyde','Loch Lomond','Midlothian','Moray','North Ayrshire','North Lanarkshire','Orkney','Perth','Renfrewshire','Scottish Borders','Shetlands','South Ayrshire','South Lanarkshire','Stirling','West Dunbartonshire','West Lothian','Western Isles'],
  'N. Ireland': ['Antrim and Newtownabbey','Ards and North Down','Armagh Banbridge Craigavon','Belfast','Causeway and Glens','Derry and Strabane','Fermanagh and Omagh','Lisburn and Castlereagh','Mid East Antrim','Mid Ulster','Newry Mourne Down','NI Strategic Planning'],
};

const COUNCIL_REGION = {};
Object.entries(REGION_MAP).forEach(([region, list]) =>
  list.forEach(c => { COUNCIL_REGION[c] = region; })
);

// ── Detect portal software from URL ──────────────────────────────
function detectSoftware(url = '') {
  const u = url.toLowerCase();
  if (u.includes('tascomi.com'))          return 'Idox';
  if (u.includes('uniformonline.co.uk'))  return 'Idox Uniform';
  if (u.includes('publicaccess'))         return 'Idox PublicAccess';
  if (u.includes('idox'))                 return 'Idox';
  if (u.includes('northgate'))            return 'Northgate';
  if (u.includes('ocellaweb') ||
      u.includes('ocella'))               return 'Ocella';
  if (u.includes('agile'))                return 'Agile';
  if (u.includes('planningexplorer'))     return 'PlanningExplorer';
  if (u.includes('acolnet'))              return 'Acolnet';
  if (u.includes('govtech'))              return 'GovTech';
  return 'Other';
}

// ── Fuzzy council name match ──────────────────────────────────────
const ALL_COUNCILS = ['Aberdeen','Aberdeenshire','Adur and Worthing','Allerdale','Amber Valley','Anglesey','Angus','Antrim and Newtownabbey','Ards and North Down','Argyll','Armagh Banbridge Craigavon','Arun','Ashfield','Ashford','Babergh Mid Suffolk','Barking and Dagenham','Barnet','Barnsley','Barrow','Basildon','Basingstoke','Bassetlaw','Bath','BCP','Bedford','Belfast','Bexley','Birmingham','Blackburn','Blackpool','Blaenau Gwent','Blaby','Bolsover','Boston','Bracknell','Bradford','Braintree','Breckland','Brent','Brentwood','Brecon Beacons','Bridgend','Brighton','Bristol','Bromley','Bromsgrove Redditch','Broxtowe','Broxbourne','Buckinghamshire','Burnley','Bury','Caerphilly','Cairngorms','Calderdale','Cambridge','Cambridgeshire','Camden','Cannock Chase','Canterbury','Cardiff','Carlisle','Carmarthenshire','Castle Point','Causeway and Glens','Central Bedfordshire','Ceredigion','Charnwood','Chelmsford','Cheltenham','Cherwell','Cheshire East','Chester','Chesterfield','Chichester','Chorley','City','Clackmannanshire','Colchester','Conwy','Copeland','Cornwall','Cotswold','Coventry','Craven','Crawley','Croydon','Cumbria','Dacorum','Darlington','Dartford','Dartmoor','Denbighshire','Derby','Derbyshire','Derbyshire Dales','Derry and Strabane','Devon','DNS Wales','Doncaster','Dorset','Dover','Dudley','Dumfries','Dundee','Durham','Ealing','East Ayrshire','East Cambridgeshire','East Devon','East Dunbartonshire','East Hampshire','East Hertfordshire','East Lindsey','East Lothian','East Renfrewshire','East Riding','East Staffordshire','East Suffolk','East Sussex','Eastbourne','Eastleigh','Edinburgh','Elmbridge','Enfield','Epping Forest','Epsom and Ewell','Erewash','Essex','Exeter','Exmoor','Falkirk','Fareham','Fenland','Fermanagh and Omagh','Fife','Flintshire','Forest of Dean','Fylde','Gateshead','Gedling','Glamorgan','Glasgow','Gloucester','Gloucestershire','Gosport','Gravesham','Great Yarmouth','Greenwich','Guildford','Guernsey','Gwynedd','Hackney','Halton','Hambleton','Hammersmith and Fulham','Hampshire','Harborough','Haringey','Harlow','Harrogate','Harrow','Hart','Hartlepool','Hastings','Havant','Havering','Herefordshire','Hertfordshire','Hertsmere','High Peak','Highland','Hillingdon','Hinckley and Bosworth','Horsham','Hounslow','Hull','Huntingdonshire','Hyndburn','Inverclyde','Ipswich','Isle of Man','Isle of Wight','Islington','Jersey','Kensington','Kent','Kings Lynn','Kingston','Kirklees','Knowsley','Lake District','Lambeth','Lancaster','Leeds','Leicester','Leicestershire','Lewes','Lewisham','Lichfield','Lincoln','Lincolnshire','Lisburn and Castlereagh','Liverpool','Loch Lomond','Luton','Maldon','Malvern Hills','Manchester','Mansfield','Medway','Melton','Mendip','Merton','Middlesbrough','Mid Devon','Mid East Antrim','Mid Kent','Mid Sussex','Mid Ulster','Midlothian','Milton Keynes','Mole Valley','Monmouthshire','Moray','Neath','New Forest (District)','New Forest (Park)','Newark and Sherwood','Newcastle under Lyme','Newcastle upon Tyne','Newham','Newport','Newry Mourne Down','NI Strategic Planning','Norfolk','North Ayrshire','North Devon','North East Derbyshire','North East Lincs','North Hertfordshire','North Kesteven','North Lanarkshire','North Lincs','North Norfolk','North Somerset','North Tyneside','North Warwickshire','North West Leicestershire','North Yorkshire','North York Moors','Northumberland (County)','Northumberland (Park)','Norwich','Nottingham','Nottinghamshire','NSIP England','NSIP Wales','Nuneaton','Oadby and Wigston','Old Oak Park Royal','Oldham','Orkney','Oxford','Oxfordshire','Peak District','Pembroke Coast','Pembrokeshire','Pendle','Perth','Peterborough','Plymouth','Powys','Preston','Reading','Redbridge','Redcar and Cleveland','Reigate','Renfrewshire','Rhondda','Ribble Valley','Richmond','Richmondshire','Rochdale','Rochford','Rossendale','Rotherham','Rother','Rugby','Runnymede','Rushcliffe','Rushmoor','Rutland','Ryedale','Salford','Sandwell','Scarborough','Scilly Isles','Scottish Borders','Sedgemoor','Sefton','Selby','Sevenoaks','Sheffield','Shepway','Shetlands','Shropshire','Slough','Snowdonia','Solihull','Somerset','South Ayrshire','South Cambridgeshire','South Derbyshire','South Downs','South Gloucestershire','South Holland','South Kesteven','South Lanarkshire','South Norfolk Broadland','South Oxfordshire','South Ribble','South Somerset','South Staffordshire','South Tyneside','South West Devon','Southend','Southampton','Southwark','Spelthorne','St Albans','St Helens','Stafford','Staffordshire','Staffordshire Moorlands','Stevenage','Stirling','Stockport','Stockton-on-Tees','Stoke on Trent','Stratford on Avon','Stroud','Suffolk','Sunderland','Surrey','Surrey Heath','Sutton','Swansea','Swindon','Tameside','Tamworth','Tandridge','Taunton Deane','Telford','Tendring','Test Valley','Tewkesbury','Thanet','Three Rivers','Thurrock','Tonbridge','Torbay','Torridge','Torfaen','Tower Hamlets','Trafford','Tunbridge Wells','Uttlesford','Vale of White Horse','Wakefield','Walsall','Waltham Forest','Wandsworth','Warrington','Warwick','Warwickshire','Watford','Waverley','Wealden','Welwyn Hatfield','West Berkshire','West Dunbartonshire','West Lancashire','West Lindsey','West Lothian','West Northamptonshire','West Oxfordshire','West Somerset','West Suffolk','West Sussex','Western Isles','Westminster','Westmorland and Furness','Wigan','Wiltshire','Winchester','Windsor','Wirral','Woking','Wokingham','Wolverhampton','Worcester','Worcestershire','Wrexham','Wychavon','Wyre','Wyre Forest','Yale of White Horse','York','Yorkshire Dales'];

function matchCouncilName(lpaName) {
  if (!lpaName) return null;
  const norm = s => s.toLowerCase().replace(/\s*(borough|city|council|district|metropolitan|unitary authority|of|the|london borough)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const target = norm(lpaName);
  // Exact match first
  let match = ALL_COUNCILS.find(c => norm(c) === target);
  if (match) return match;
  // Substring match
  match = ALL_COUNCILS.find(c => target.includes(norm(c)) || norm(c).includes(target));
  return match || null;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('⟳ Fetching LPA dataset from planning.data.gov.uk…');

  const resp = await fetch('https://www.planning.data.gov.uk/dataset/local-planning-authority.json?limit=500', {
    headers: { Accept: 'application/json' }
  });

  if (!resp.ok) {
    console.error(`✗ HTTP ${resp.status} from planning.data.gov.uk`);
    process.exit(1);
  }

  const raw = await resp.json();
  // The endpoint returns { entities: [...] } or { count, results: [...] }
  const lpas = raw.entities || raw.results || raw;

  console.log(`✓ Received ${lpas.length} LPAs`);

  const rows = [];
  let matched = 0, unmatched = 0;

  for (const lpa of lpas) {
    const lpaName    = lpa.name || lpa.reference || '';
    const websiteUrl = lpa.website || lpa.entity?.website || '';

    const councilName = matchCouncilName(lpaName);
    if (!councilName) {
      unmatched++;
      continue;
    }
    matched++;

    const software = detectSoftware(websiteUrl);
    const region   = COUNCIL_REGION[councilName] || null;

    rows.push({
      council_name:    councilName,
      region,
      software_type:   software,
      portal_base_url: websiteUrl || null,
      has_rest_api:    software === 'Idox',  // Idox councils have REST API (pending API key)
      has_agent_email: false,  // updated manually after testing
      has_agent_phone: false,
      notes: `Seeded from planning.data.gov.uk — ${new Date().toISOString().slice(0,10)}`,
    });
  }

  console.log(`✓ Matched ${matched} councils (${unmatched} LPAs not matched to council list)`);

  // Also insert any councils in ALL_COUNCILS not found in DLUHC data
  const foundNames = new Set(rows.map(r => r.council_name));
  for (const c of ALL_COUNCILS) {
    if (!foundNames.has(c)) {
      rows.push({
        council_name:    c,
        region:          COUNCIL_REGION[c] || null,
        software_type:   'Other',
        portal_base_url: null,
        has_rest_api:    false,
        has_agent_email: false,
        has_agent_phone: false,
        notes:           'Not found in planning.data.gov.uk — manual update needed',
      });
    }
  }

  console.log(`⟳ Upserting ${rows.length} rows into council_portal_configs…`);

  // Upsert in batches of 50
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('council_portal_configs')
      .upsert(batch, { onConflict: 'council_name', ignoreDuplicates: false });

    if (error) {
      console.error(`✗ Batch ${Math.floor(i/BATCH)+1} error:`, error.message);
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  ${inserted}/${rows.length}`);
    }
  }

  console.log(`\n✓ Done — ${inserted} rows upserted into council_portal_configs`);
  console.log('\nNext steps:');
  console.log('  1. In Supabase SQL editor, enable pgvector: Extensions → search "vector" → enable');
  console.log('  2. Run supabase-schema.sql to create the council_portal_configs table');
  console.log('  3. Then run this script to seed data');
  console.log('  4. For Idox councils, register at https://idoxgroup.com to obtain API keys');
  console.log('  5. Update rows: UPDATE council_portal_configs SET tascomi_api_key=\'...\', has_rest_api=true WHERE council_name=\'Hackney\'');
}

main().catch(err => {
  console.error('✗ Fatal:', err.message);
  process.exit(1);
});
