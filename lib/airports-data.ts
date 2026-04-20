/**
 * Curated IATA airport dataset for the Departure / Destination autocomplete.
 *
 * Covers ~250 airports across major global hubs. Multi-airport metros (NYC,
 * LON, PAR, TYO, WAS, etc.) have a `metro` group so the picker can offer
 * "All NYC airports" as a single option.
 *
 * The autocomplete value is either the IATA code (single airport) or the
 * metro display name (e.g. "New York"). The backend's `resolveMultiAirport`
 * in lib/tools.ts handles both.
 */

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  /** Metro group key (e.g. "NYC", "LON"). Set only for multi-airport cities. */
  metro?: string;
}

export interface MetroArea {
  code: string;      // e.g. "NYC"
  name: string;      // e.g. "New York" — what users see / type
  airports: string[]; // IATA codes in the metro
  country: string;
}

export const METRO_AREAS: MetroArea[] = [
  { code: "NYC", name: "New York",        airports: ["JFK", "LGA", "EWR"], country: "USA" },
  { code: "LON", name: "London",          airports: ["LHR", "LGW", "STN", "LTN", "LCY"], country: "UK" },
  { code: "PAR", name: "Paris",           airports: ["CDG", "ORY", "BVA"], country: "France" },
  { code: "TYO", name: "Tokyo",           airports: ["HND", "NRT"], country: "Japan" },
  { code: "WAS", name: "Washington",      airports: ["IAD", "DCA", "BWI"], country: "USA" },
  { code: "CHI", name: "Chicago",         airports: ["ORD", "MDW"], country: "USA" },
  { code: "SFO", name: "San Francisco Bay", airports: ["SFO", "OAK", "SJC"], country: "USA" },
  { code: "MIL", name: "Milan",           airports: ["MXP", "LIN", "BGY"], country: "Italy" },
  { code: "ROM", name: "Rome",            airports: ["FCO", "CIA"], country: "Italy" },
  { code: "MOW", name: "Moscow",          airports: ["SVO", "DME", "VKO"], country: "Russia" },
  { code: "BKK", name: "Bangkok",         airports: ["BKK", "DMK"], country: "Thailand" },
  { code: "OSA", name: "Osaka",           airports: ["KIX", "ITM"], country: "Japan" },
  { code: "SHA", name: "Shanghai",        airports: ["PVG", "SHA"], country: "China" },
  { code: "BJS", name: "Beijing",         airports: ["PEK", "PKX"], country: "China" },
  { code: "TPE", name: "Taipei",          airports: ["TPE", "TSA"], country: "Taiwan" },
  { code: "SEL", name: "Seoul",           airports: ["ICN", "GMP"], country: "South Korea" },
  { code: "BUE", name: "Buenos Aires",    airports: ["EZE", "AEP"], country: "Argentina" },
  { code: "SAO", name: "São Paulo",       airports: ["GRU", "CGH", "VCP"], country: "Brazil" },
  { code: "RIO", name: "Rio de Janeiro",  airports: ["GIG", "SDU"], country: "Brazil" },
  { code: "IST", name: "Istanbul",        airports: ["IST", "SAW"], country: "Turkey" },
  { code: "BER", name: "Berlin",          airports: ["BER"], country: "Germany" },
  { code: "STO", name: "Stockholm",       airports: ["ARN", "BMA"], country: "Sweden" },
  { code: "YTO", name: "Toronto",         airports: ["YYZ", "YTZ"], country: "Canada" },
  { code: "YMQ", name: "Montreal",        airports: ["YUL"], country: "Canada" },
  { code: "OSL", name: "Oslo",            airports: ["OSL"], country: "Norway" },
];

export const AIRPORTS: Airport[] = [
  // USA — major hubs
  { iata: "JFK", name: "John F. Kennedy International", city: "New York",        country: "USA", metro: "NYC" },
  { iata: "LGA", name: "LaGuardia",                     city: "New York",        country: "USA", metro: "NYC" },
  { iata: "EWR", name: "Newark Liberty International",  city: "Newark",          country: "USA", metro: "NYC" },
  { iata: "LAX", name: "Los Angeles International",     city: "Los Angeles",     country: "USA" },
  { iata: "BUR", name: "Hollywood Burbank",             city: "Burbank",         country: "USA" },
  { iata: "LGB", name: "Long Beach",                    city: "Long Beach",      country: "USA" },
  { iata: "SNA", name: "John Wayne",                    city: "Santa Ana",       country: "USA" },
  { iata: "SFO", name: "San Francisco International",   city: "San Francisco",   country: "USA", metro: "SFO" },
  { iata: "OAK", name: "Oakland International",         city: "Oakland",         country: "USA", metro: "SFO" },
  { iata: "SJC", name: "San Jose International",        city: "San Jose",        country: "USA", metro: "SFO" },
  { iata: "ORD", name: "O'Hare International",          city: "Chicago",         country: "USA", metro: "CHI" },
  { iata: "MDW", name: "Midway",                        city: "Chicago",         country: "USA", metro: "CHI" },
  { iata: "ATL", name: "Hartsfield-Jackson",            city: "Atlanta",         country: "USA" },
  { iata: "DFW", name: "Dallas/Fort Worth International", city: "Dallas",        country: "USA" },
  { iata: "DAL", name: "Dallas Love Field",             city: "Dallas",          country: "USA" },
  { iata: "DEN", name: "Denver International",          city: "Denver",          country: "USA" },
  { iata: "SEA", name: "Seattle-Tacoma International",  city: "Seattle",         country: "USA" },
  { iata: "BOS", name: "Logan International",           city: "Boston",          country: "USA" },
  { iata: "MIA", name: "Miami International",           city: "Miami",           country: "USA" },
  { iata: "FLL", name: "Fort Lauderdale-Hollywood",     city: "Fort Lauderdale", country: "USA" },
  { iata: "IAH", name: "George Bush Intercontinental",  city: "Houston",         country: "USA" },
  { iata: "HOU", name: "Hobby",                         city: "Houston",         country: "USA" },
  { iata: "IAD", name: "Dulles International",          city: "Washington",      country: "USA", metro: "WAS" },
  { iata: "DCA", name: "Reagan National",               city: "Washington",      country: "USA", metro: "WAS" },
  { iata: "BWI", name: "Baltimore/Washington International", city: "Baltimore",  country: "USA", metro: "WAS" },
  { iata: "PHX", name: "Sky Harbor",                    city: "Phoenix",         country: "USA" },
  { iata: "LAS", name: "Harry Reid International",      city: "Las Vegas",       country: "USA" },
  { iata: "MCO", name: "Orlando International",         city: "Orlando",         country: "USA" },
  { iata: "PHL", name: "Philadelphia International",    city: "Philadelphia",    country: "USA" },
  { iata: "CLT", name: "Charlotte Douglas",             city: "Charlotte",       country: "USA" },
  { iata: "DTW", name: "Detroit Metropolitan",          city: "Detroit",         country: "USA" },
  { iata: "MSP", name: "Minneapolis-St Paul",           city: "Minneapolis",     country: "USA" },
  { iata: "BNA", name: "Nashville International",       city: "Nashville",       country: "USA" },
  { iata: "AUS", name: "Austin-Bergstrom",              city: "Austin",          country: "USA" },
  { iata: "SAN", name: "San Diego International",       city: "San Diego",       country: "USA" },
  { iata: "PDX", name: "Portland International",        city: "Portland",        country: "USA" },
  { iata: "SLC", name: "Salt Lake City International",  city: "Salt Lake City",  country: "USA" },
  { iata: "STL", name: "Lambert St. Louis",             city: "St. Louis",       country: "USA" },
  { iata: "TPA", name: "Tampa International",           city: "Tampa",           country: "USA" },
  { iata: "RDU", name: "Raleigh-Durham",                city: "Raleigh",         country: "USA" },
  { iata: "MCI", name: "Kansas City International",     city: "Kansas City",     country: "USA" },
  { iata: "IND", name: "Indianapolis International",    city: "Indianapolis",    country: "USA" },
  { iata: "CLE", name: "Cleveland Hopkins",             city: "Cleveland",       country: "USA" },
  { iata: "CVG", name: "Cincinnati/Northern Kentucky",  city: "Cincinnati",      country: "USA" },
  { iata: "MKE", name: "Milwaukee Mitchell",            city: "Milwaukee",       country: "USA" },
  { iata: "PIT", name: "Pittsburgh International",      city: "Pittsburgh",      country: "USA" },
  { iata: "BUF", name: "Buffalo Niagara",               city: "Buffalo",         country: "USA" },
  { iata: "ABQ", name: "Albuquerque International",     city: "Albuquerque",     country: "USA" },
  { iata: "OKC", name: "Will Rogers World",             city: "Oklahoma City",   country: "USA" },
  { iata: "MEM", name: "Memphis International",         city: "Memphis",         country: "USA" },
  { iata: "RSW", name: "Southwest Florida International", city: "Fort Myers",    country: "USA" },
  { iata: "JAX", name: "Jacksonville International",    city: "Jacksonville",    country: "USA" },
  { iata: "SAT", name: "San Antonio International",     city: "San Antonio",     country: "USA" },
  { iata: "HNL", name: "Daniel K. Inouye International", city: "Honolulu",       country: "USA" },
  { iata: "OGG", name: "Kahului",                       city: "Maui",            country: "USA" },
  { iata: "ANC", name: "Ted Stevens Anchorage",         city: "Anchorage",       country: "USA" },

  // Canada
  { iata: "YYZ", name: "Toronto Pearson International", city: "Toronto",         country: "Canada", metro: "YTO" },
  { iata: "YTZ", name: "Billy Bishop Toronto City",     city: "Toronto",         country: "Canada", metro: "YTO" },
  { iata: "YUL", name: "Montreal-Trudeau",              city: "Montreal",        country: "Canada", metro: "YMQ" },
  { iata: "YVR", name: "Vancouver International",       city: "Vancouver",       country: "Canada" },
  { iata: "YYC", name: "Calgary International",         city: "Calgary",         country: "Canada" },
  { iata: "YEG", name: "Edmonton International",        city: "Edmonton",        country: "Canada" },
  { iata: "YOW", name: "Ottawa Macdonald-Cartier",      city: "Ottawa",          country: "Canada" },
  { iata: "YHZ", name: "Halifax Stanfield",             city: "Halifax",         country: "Canada" },
  { iata: "YWG", name: "Winnipeg Richardson",           city: "Winnipeg",        country: "Canada" },

  // UK
  { iata: "LHR", name: "Heathrow",                      city: "London",          country: "UK",   metro: "LON" },
  { iata: "LGW", name: "Gatwick",                       city: "London",          country: "UK",   metro: "LON" },
  { iata: "STN", name: "Stansted",                      city: "London",          country: "UK",   metro: "LON" },
  { iata: "LTN", name: "Luton",                         city: "London",          country: "UK",   metro: "LON" },
  { iata: "LCY", name: "London City",                   city: "London",          country: "UK",   metro: "LON" },
  { iata: "MAN", name: "Manchester",                    city: "Manchester",      country: "UK" },
  { iata: "EDI", name: "Edinburgh",                     city: "Edinburgh",       country: "UK" },
  { iata: "BHX", name: "Birmingham",                    city: "Birmingham",      country: "UK" },
  { iata: "GLA", name: "Glasgow",                       city: "Glasgow",         country: "UK" },
  { iata: "BRS", name: "Bristol",                       city: "Bristol",         country: "UK" },
  { iata: "DUB", name: "Dublin",                        city: "Dublin",          country: "Ireland" },

  // Europe — continental
  { iata: "CDG", name: "Charles de Gaulle",             city: "Paris",           country: "France", metro: "PAR" },
  { iata: "ORY", name: "Orly",                          city: "Paris",           country: "France", metro: "PAR" },
  { iata: "BVA", name: "Beauvais-Tillé",                city: "Paris",           country: "France", metro: "PAR" },
  { iata: "NCE", name: "Nice Côte d'Azur",              city: "Nice",            country: "France" },
  { iata: "MRS", name: "Marseille Provence",            city: "Marseille",       country: "France" },
  { iata: "LYS", name: "Lyon-Saint Exupéry",            city: "Lyon",            country: "France" },
  { iata: "TLS", name: "Toulouse-Blagnac",              city: "Toulouse",        country: "France" },
  { iata: "FRA", name: "Frankfurt",                     city: "Frankfurt",       country: "Germany" },
  { iata: "MUC", name: "Munich",                        city: "Munich",          country: "Germany" },
  { iata: "BER", name: "Berlin Brandenburg",            city: "Berlin",          country: "Germany", metro: "BER" },
  { iata: "DUS", name: "Düsseldorf",                    city: "Düsseldorf",      country: "Germany" },
  { iata: "HAM", name: "Hamburg",                       city: "Hamburg",         country: "Germany" },
  { iata: "CGN", name: "Cologne/Bonn",                  city: "Cologne",         country: "Germany" },
  { iata: "STR", name: "Stuttgart",                     city: "Stuttgart",       country: "Germany" },
  { iata: "AMS", name: "Schiphol",                      city: "Amsterdam",       country: "Netherlands" },
  { iata: "BRU", name: "Brussels",                      city: "Brussels",        country: "Belgium" },
  { iata: "MAD", name: "Adolfo Suárez Madrid-Barajas",  city: "Madrid",          country: "Spain" },
  { iata: "BCN", name: "Barcelona-El Prat",             city: "Barcelona",       country: "Spain" },
  { iata: "AGP", name: "Málaga-Costa del Sol",          city: "Málaga",          country: "Spain" },
  { iata: "PMI", name: "Palma de Mallorca",             city: "Palma",           country: "Spain" },
  { iata: "VLC", name: "Valencia",                      city: "Valencia",        country: "Spain" },
  { iata: "LIS", name: "Humberto Delgado",              city: "Lisbon",          country: "Portugal" },
  { iata: "OPO", name: "Porto",                         city: "Porto",           country: "Portugal" },
  { iata: "FCO", name: "Fiumicino",                     city: "Rome",            country: "Italy",  metro: "ROM" },
  { iata: "CIA", name: "Ciampino",                      city: "Rome",            country: "Italy",  metro: "ROM" },
  { iata: "MXP", name: "Malpensa",                      city: "Milan",           country: "Italy",  metro: "MIL" },
  { iata: "LIN", name: "Linate",                        city: "Milan",           country: "Italy",  metro: "MIL" },
  { iata: "BGY", name: "Bergamo",                       city: "Milan",           country: "Italy",  metro: "MIL" },
  { iata: "VCE", name: "Venice Marco Polo",             city: "Venice",          country: "Italy" },
  { iata: "NAP", name: "Naples",                        city: "Naples",          country: "Italy" },
  { iata: "FLR", name: "Florence",                      city: "Florence",        country: "Italy" },
  { iata: "ZRH", name: "Zurich",                        city: "Zurich",          country: "Switzerland" },
  { iata: "GVA", name: "Geneva",                        city: "Geneva",          country: "Switzerland" },
  { iata: "VIE", name: "Vienna",                        city: "Vienna",          country: "Austria" },
  { iata: "CPH", name: "Copenhagen",                    city: "Copenhagen",      country: "Denmark" },
  { iata: "ARN", name: "Stockholm Arlanda",             city: "Stockholm",       country: "Sweden", metro: "STO" },
  { iata: "BMA", name: "Bromma",                        city: "Stockholm",       country: "Sweden", metro: "STO" },
  { iata: "HEL", name: "Helsinki-Vantaa",               city: "Helsinki",        country: "Finland" },
  { iata: "OSL", name: "Oslo Gardermoen",               city: "Oslo",            country: "Norway", metro: "OSL" },
  { iata: "KEF", name: "Keflavík",                      city: "Reykjavík",       country: "Iceland" },
  { iata: "ATH", name: "Athens",                        city: "Athens",          country: "Greece" },
  { iata: "IST", name: "Istanbul",                      city: "Istanbul",        country: "Turkey", metro: "IST" },
  { iata: "SAW", name: "Sabiha Gökçen",                 city: "Istanbul",        country: "Turkey", metro: "IST" },
  { iata: "WAW", name: "Warsaw Chopin",                 city: "Warsaw",          country: "Poland" },
  { iata: "PRG", name: "Václav Havel Prague",           city: "Prague",          country: "Czechia" },
  { iata: "BUD", name: "Budapest Ferenc Liszt",         city: "Budapest",        country: "Hungary" },
  { iata: "SVO", name: "Sheremetyevo",                  city: "Moscow",          country: "Russia", metro: "MOW" },
  { iata: "DME", name: "Domodedovo",                    city: "Moscow",          country: "Russia", metro: "MOW" },
  { iata: "VKO", name: "Vnukovo",                       city: "Moscow",          country: "Russia", metro: "MOW" },
  { iata: "LED", name: "Pulkovo",                       city: "St. Petersburg",  country: "Russia" },

  // Middle East
  { iata: "DXB", name: "Dubai International",           city: "Dubai",           country: "UAE" },
  { iata: "DWC", name: "Al Maktoum",                    city: "Dubai",           country: "UAE" },
  { iata: "AUH", name: "Abu Dhabi International",       city: "Abu Dhabi",       country: "UAE" },
  { iata: "DOH", name: "Hamad International",           city: "Doha",            country: "Qatar" },
  { iata: "TLV", name: "Ben Gurion",                    city: "Tel Aviv",        country: "Israel" },
  { iata: "AMM", name: "Queen Alia",                    city: "Amman",           country: "Jordan" },
  { iata: "RUH", name: "King Khalid",                   city: "Riyadh",          country: "Saudi Arabia" },
  { iata: "JED", name: "King Abdulaziz",                city: "Jeddah",          country: "Saudi Arabia" },
  { iata: "CAI", name: "Cairo International",           city: "Cairo",           country: "Egypt" },

  // Asia
  { iata: "HND", name: "Haneda",                        city: "Tokyo",           country: "Japan",  metro: "TYO" },
  { iata: "NRT", name: "Narita International",          city: "Tokyo",           country: "Japan",  metro: "TYO" },
  { iata: "KIX", name: "Kansai International",          city: "Osaka",           country: "Japan",  metro: "OSA" },
  { iata: "ITM", name: "Itami",                         city: "Osaka",           country: "Japan",  metro: "OSA" },
  { iata: "NGO", name: "Chubu Centrair",                city: "Nagoya",          country: "Japan" },
  { iata: "CTS", name: "New Chitose",                   city: "Sapporo",         country: "Japan" },
  { iata: "FUK", name: "Fukuoka",                       city: "Fukuoka",         country: "Japan" },
  { iata: "OKA", name: "Naha",                          city: "Okinawa",         country: "Japan" },
  { iata: "ICN", name: "Incheon International",         city: "Seoul",           country: "South Korea", metro: "SEL" },
  { iata: "GMP", name: "Gimpo",                         city: "Seoul",           country: "South Korea", metro: "SEL" },
  { iata: "PUS", name: "Gimhae",                        city: "Busan",           country: "South Korea" },
  { iata: "CJU", name: "Jeju",                          city: "Jeju",            country: "South Korea" },
  { iata: "PEK", name: "Beijing Capital",               city: "Beijing",         country: "China",  metro: "BJS" },
  { iata: "PKX", name: "Beijing Daxing",                city: "Beijing",         country: "China",  metro: "BJS" },
  { iata: "PVG", name: "Shanghai Pudong",               city: "Shanghai",        country: "China",  metro: "SHA" },
  { iata: "SHA", name: "Shanghai Hongqiao",             city: "Shanghai",        country: "China",  metro: "SHA" },
  { iata: "CAN", name: "Guangzhou Baiyun",              city: "Guangzhou",       country: "China" },
  { iata: "SZX", name: "Shenzhen Bao'an",               city: "Shenzhen",        country: "China" },
  { iata: "CTU", name: "Chengdu Shuangliu",             city: "Chengdu",         country: "China" },
  { iata: "TFU", name: "Chengdu Tianfu",                city: "Chengdu",         country: "China" },
  { iata: "XIY", name: "Xi'an Xianyang",                city: "Xi'an",           country: "China" },
  { iata: "HGH", name: "Hangzhou Xiaoshan",             city: "Hangzhou",        country: "China" },
  { iata: "NKG", name: "Nanjing Lukou",                 city: "Nanjing",         country: "China" },
  { iata: "KMG", name: "Kunming Changshui",             city: "Kunming",         country: "China" },
  { iata: "TSN", name: "Tianjin Binhai",                city: "Tianjin",         country: "China" },
  { iata: "CKG", name: "Chongqing Jiangbei",            city: "Chongqing",       country: "China" },
  { iata: "HKG", name: "Hong Kong International",       city: "Hong Kong",       country: "Hong Kong" },
  { iata: "MFM", name: "Macau International",           city: "Macau",           country: "Macau" },
  { iata: "TPE", name: "Taoyuan International",         city: "Taipei",          country: "Taiwan", metro: "TPE" },
  { iata: "TSA", name: "Songshan",                      city: "Taipei",          country: "Taiwan", metro: "TPE" },
  { iata: "KHH", name: "Kaohsiung International",       city: "Kaohsiung",       country: "Taiwan" },
  { iata: "SIN", name: "Changi",                        city: "Singapore",       country: "Singapore" },
  { iata: "BKK", name: "Suvarnabhumi",                  city: "Bangkok",         country: "Thailand", metro: "BKK" },
  { iata: "DMK", name: "Don Mueang",                    city: "Bangkok",         country: "Thailand", metro: "BKK" },
  { iata: "HKT", name: "Phuket International",          city: "Phuket",          country: "Thailand" },
  { iata: "CNX", name: "Chiang Mai International",      city: "Chiang Mai",      country: "Thailand" },
  { iata: "KUL", name: "Kuala Lumpur International",    city: "Kuala Lumpur",    country: "Malaysia" },
  { iata: "PEN", name: "Penang International",          city: "Penang",          country: "Malaysia" },
  { iata: "CGK", name: "Soekarno-Hatta",                city: "Jakarta",         country: "Indonesia" },
  { iata: "DPS", name: "Ngurah Rai (Bali)",             city: "Denpasar",        country: "Indonesia" },
  { iata: "SUB", name: "Juanda",                        city: "Surabaya",        country: "Indonesia" },
  { iata: "MNL", name: "Ninoy Aquino",                  city: "Manila",          country: "Philippines" },
  { iata: "CEB", name: "Mactan-Cebu",                   city: "Cebu",            country: "Philippines" },
  { iata: "SGN", name: "Tan Son Nhat",                  city: "Ho Chi Minh City", country: "Vietnam" },
  { iata: "HAN", name: "Noi Bai",                       city: "Hanoi",           country: "Vietnam" },
  { iata: "DAD", name: "Da Nang",                       city: "Da Nang",         country: "Vietnam" },
  { iata: "DEL", name: "Indira Gandhi International",   city: "Delhi",           country: "India" },
  { iata: "BOM", name: "Chhatrapati Shivaji",           city: "Mumbai",          country: "India" },
  { iata: "BLR", name: "Kempegowda",                    city: "Bengaluru",       country: "India" },
  { iata: "MAA", name: "Chennai International",         city: "Chennai",         country: "India" },
  { iata: "CCU", name: "Netaji Subhas Chandra Bose",    city: "Kolkata",         country: "India" },
  { iata: "HYD", name: "Rajiv Gandhi",                  city: "Hyderabad",       country: "India" },
  { iata: "GOI", name: "Dabolim",                       city: "Goa",             country: "India" },
  { iata: "CMB", name: "Bandaranaike",                  city: "Colombo",         country: "Sri Lanka" },
  { iata: "KTM", name: "Tribhuvan International",       city: "Kathmandu",       country: "Nepal" },

  // Oceania
  { iata: "SYD", name: "Kingsford Smith",               city: "Sydney",          country: "Australia" },
  { iata: "MEL", name: "Melbourne Tullamarine",         city: "Melbourne",       country: "Australia" },
  { iata: "BNE", name: "Brisbane International",        city: "Brisbane",        country: "Australia" },
  { iata: "PER", name: "Perth International",           city: "Perth",           country: "Australia" },
  { iata: "ADL", name: "Adelaide",                      city: "Adelaide",        country: "Australia" },
  { iata: "CNS", name: "Cairns",                        city: "Cairns",          country: "Australia" },
  { iata: "OOL", name: "Gold Coast",                    city: "Gold Coast",      country: "Australia" },
  { iata: "AKL", name: "Auckland",                      city: "Auckland",        country: "New Zealand" },
  { iata: "CHC", name: "Christchurch",                  city: "Christchurch",    country: "New Zealand" },
  { iata: "WLG", name: "Wellington",                    city: "Wellington",      country: "New Zealand" },
  { iata: "NAN", name: "Nadi",                          city: "Nadi",            country: "Fiji" },

  // Latin America
  { iata: "MEX", name: "Benito Juárez",                 city: "Mexico City",     country: "Mexico" },
  { iata: "NLU", name: "Felipe Ángeles",                city: "Mexico City",     country: "Mexico" },
  { iata: "CUN", name: "Cancún",                        city: "Cancún",          country: "Mexico" },
  { iata: "GDL", name: "Guadalajara",                   city: "Guadalajara",     country: "Mexico" },
  { iata: "MTY", name: "Monterrey",                     city: "Monterrey",       country: "Mexico" },
  { iata: "PVR", name: "Puerto Vallarta",               city: "Puerto Vallarta", country: "Mexico" },
  { iata: "SJD", name: "Los Cabos",                     city: "Los Cabos",       country: "Mexico" },
  { iata: "GRU", name: "Guarulhos",                     city: "São Paulo",       country: "Brazil", metro: "SAO" },
  { iata: "CGH", name: "Congonhas",                     city: "São Paulo",       country: "Brazil", metro: "SAO" },
  { iata: "VCP", name: "Viracopos",                     city: "São Paulo",       country: "Brazil", metro: "SAO" },
  { iata: "GIG", name: "Galeão",                        city: "Rio de Janeiro",  country: "Brazil", metro: "RIO" },
  { iata: "SDU", name: "Santos Dumont",                 city: "Rio de Janeiro",  country: "Brazil", metro: "RIO" },
  { iata: "BSB", name: "Brasília",                      city: "Brasília",        country: "Brazil" },
  { iata: "EZE", name: "Ministro Pistarini",            city: "Buenos Aires",    country: "Argentina", metro: "BUE" },
  { iata: "AEP", name: "Jorge Newbery",                 city: "Buenos Aires",    country: "Argentina", metro: "BUE" },
  { iata: "SCL", name: "Arturo Merino Benítez",         city: "Santiago",        country: "Chile" },
  { iata: "LIM", name: "Jorge Chávez",                  city: "Lima",            country: "Peru" },
  { iata: "BOG", name: "El Dorado",                     city: "Bogotá",          country: "Colombia" },
  { iata: "UIO", name: "Mariscal Sucre",                city: "Quito",           country: "Ecuador" },
  { iata: "CCS", name: "Simón Bolívar",                 city: "Caracas",         country: "Venezuela" },
  { iata: "PTY", name: "Tocumen",                       city: "Panama City",     country: "Panama" },
  { iata: "SJO", name: "Juan Santamaría",               city: "San José",        country: "Costa Rica" },
  { iata: "HAV", name: "José Martí",                    city: "Havana",          country: "Cuba" },
  { iata: "SDQ", name: "Las Américas",                  city: "Santo Domingo",   country: "Dominican Republic" },
  { iata: "PUJ", name: "Punta Cana International",      city: "Punta Cana",      country: "Dominican Republic" },

  // Africa
  { iata: "JNB", name: "OR Tambo",                      city: "Johannesburg",    country: "South Africa" },
  { iata: "CPT", name: "Cape Town International",       city: "Cape Town",       country: "South Africa" },
  { iata: "DUR", name: "King Shaka",                    city: "Durban",          country: "South Africa" },
  { iata: "NBO", name: "Jomo Kenyatta",                 city: "Nairobi",         country: "Kenya" },
  { iata: "ADD", name: "Bole International",            city: "Addis Ababa",     country: "Ethiopia" },
  { iata: "LOS", name: "Murtala Muhammed",              city: "Lagos",           country: "Nigeria" },
  { iata: "CMN", name: "Mohammed V",                    city: "Casablanca",      country: "Morocco" },
  { iata: "RAK", name: "Marrakech-Menara",              city: "Marrakech",       country: "Morocco" },
];

/**
 * Search airports + metros by query. Returns metros first (bundling multi-airport
 * options), then individual airports. Match is case-insensitive against:
 * IATA code, airport name, city, country, and metro name.
 */
export interface AirportSearchResult {
  kind: "airport" | "metro";
  value: string;         // stored on the form — IATA for airport, metro name for metro
  label: string;         // primary text shown in the dropdown
  sublabel: string;      // secondary text (city / country / airport count)
}

export function searchAirports(query: string, maxResults = 8): AirportSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const out: AirportSearchResult[] = [];
  const seenMetros = new Set<string>();

  // Metros first
  for (const m of METRO_AREAS) {
    const hay = `${m.code} ${m.name} ${m.country}`.toLowerCase();
    if (hay.includes(q)) {
      out.push({
        kind: "metro",
        value: m.name,
        label: `${m.name} — All airports`,
        sublabel: `${m.country} · ${m.airports.join(" / ")}`,
      });
      seenMetros.add(m.code);
      if (out.length >= maxResults) return out;
    }
  }

  // Airports
  for (const a of AIRPORTS) {
    // Skip airports already represented by their metro (avoid noise when metro matched)
    const hay = `${a.iata} ${a.name} ${a.city} ${a.country} ${a.metro ?? ""}`.toLowerCase();
    if (hay.includes(q)) {
      out.push({
        kind: "airport",
        value: a.iata,
        label: `${a.iata} — ${a.city}`,
        sublabel: `${a.name}${a.country ? ` · ${a.country}` : ""}`,
      });
      if (out.length >= maxResults) return out;
    }
  }

  return out;
}
