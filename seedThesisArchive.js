// seedThesisArchive.js
// Seeds all thesis/research output entries into the Thesis Archive (room_id = 3)
// Run from backend root: node seedThesisArchive.js

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { query, withTransaction } = require('./src/config/db');

const ROOM_ID = 3; // Thesis Archive (CPEIS / Room 3)

const theses = [
  { barcode:"3534484892", title:"Level of Awareness in Traffic Signages of Drivers in Virac, Catanduanes", authors:"Abrasaldo, Kristel Charisse; Sarmiento, Elya Nnah; Mario, Marie Denn; Binas, Carla Mae; Magdaraog, Neil Jonas", year:"2017", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2017-0001", copies:3 },
  { barcode:"8802376038", title:"Comparison of Driving Behaviors Between Licensed and Unlicensed Drivers in Virac, Catanduanes Updated 2017", authors:"Alberto, Jo Hin Rei; Aula, Rene Constantine; Bobier, Ei Jward; Buirce, Alex Xavier; Cueva, Jerson", year:"2017", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2017-0002", copies:2 },
  { barcode:"1449491073", title:"Evaluation of the Geometric Design of a Road Located at Brgy. Village, Virac, Catanduanes", authors:"Magno, O. Lulls S.; Olalo, Christine Gel B.; Tenerife, Deborah; Tayamora, Sarah Jane M.", year:"2017", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2017-0003", copies:3 },
  { barcode:"0530955958", title:"Accident Analysis on the Major Thoroughfares in Virac, Catanduanes", authors:"Vitalicio, Lucky TV.; Bernal, Ronald; Barro, Mark Rey; Aznar, Renannal; Bonaagua, Giselle Andrea S.", year:"2017", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2017-0004", copies:2 },
  { barcode:"8198135906", title:"Level of Awareness in Traffic Signages of Drivers in Virac, Catanduanes (Section 5B)", authors:"Barba, Melissa T.; Benigdez, Ayesa A.; Bongon, Marilyn; Bugaos, Azole A.; Cabana, Mae Alexis D.", year:"2017", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2017-0005", copies:3 },
  { barcode:"6934299055", title:"A Feasibility of Rehabilitation of Water Supply System in Virac", authors:"Soliveres, Jaymah S.M.; Sorreda, Maria Angela D.; Suede, The Alfred Jr.; Suncion, Regie A.", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0015", copies:1 },
  { barcode:"0984344207", title:"A Feasibility Study on Flood Control Drainage System in Pajo", authors:"Tajan, Kristine Bernadette C.; Tapel, Warren Cessar; Talan, Daryl Mark Z.; Taller, Jan", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0016", copies:1 },
  { barcode:"2806351318", title:"A Feasibility Study of Mini-Hydropower Plant in Sogod, Virac, Catanduanes", authors:"Tan Jr., Aniceto; Tayamora, Francis; Tapel, Franco Ysrael; Ta Roy, Mekaela Louise", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0017", copies:1 },
  { barcode:"8453328221", title:"A Feasibility Study of Construction of a Concrete Water Dunk at Brgt. Cagna Bay, Bato, Catanduanes", authors:"Tayamora II, Remegio; Tayamora, Sarah Jane; Tenerife, Deborah D.; Tating, Ricky; Teves, Jaymar", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0018", copies:1 },
  { barcode:"2910208248", title:"A Feasibility Study on Hydrological Source of Electricity for Danricop, Moonwalk and Gogon Sirangan in Virac, Catanduanes", authors:"Tebeuin, Henry A.; Timbal Jr., Renato T.; Urbano, Jayrald T.; Vista, Gladys C.", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0019", copies:1 },
  { barcode:"8417529273", title:"A Feasibility Study on the Water Storage Tank in Cavintan, Virac, Catanduanes", authors:"Tixon, Philip L.; Trinidad, Roiven R.; Velasco, Lucky A.; Ville Gas, John Errol S.; Zafe Jr., Zaldy T.", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-FS-2018-0020", copies:1 },
  { barcode:"0823024733", title:"Service Quality Assessment of Commuter's Mode of Transportation from Bagamanoc, Caramoran, Pandan, Panganiban and Viga", authors:"Alberto, Krisleen Air John Kevin II; Bañares, Joian Bave V.; Del Valle, Taul Joseph N.", year:"2018", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-RO-2018-0001", copies:1 },
  { barcode:"9812792577", title:"Trilodemode: Three-Wheeled Cycle Arduino-Based Using HX71.1 Module Load Detection and Monitoring Device", authors:"Gianan, John Patrick E.; Posada, Jay Johnson B.; Toledo, Lester John; Torrecampo, Faith Angela B.", year:"2023", adviser:"Engr. Nanette M.J. Valeza", code:"CEA-RDS-CPE-2023-0008", copies:2 },
  { barcode:"0244420452", title:"Automatic Reverse Vending Machine with User-Authenticated Transaction and Load-Dumping Mechanism", authors:"Magallanes, Kenneth C.; Robles, Joseph Ceasar T.; Talion, Ma. Melissa Joy V.; Vallespin, Leo Jr.", year:"2023", adviser:"Engr. Jose Tapel", code:"CEA-RDS-CPE-2023-0009", copies:3 },
  { barcode:"8621105410", title:"Implementation of Vehicle Tracking Accident Notification System in Utility Pole", authors:"Ruel, Axel Jorge An A.; Tablizo, Jhan Li-Jo R.; Ibardaloza, Vince Christian I.; Caballero, Ma. Trix", year:"2023", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2023-0010", copies:2 },
  { barcode:"4511591261", title:"Design of Drainage in Antipolo del Norte, Virac, Catanduanes", authors:"Aguirre, Cindy S.; Maniaognit, Viniessa Z.; Portanoba, Joshua B.; Sicid, John Melvin B.", year:"2023", adviser:"Engr. Melvin McArthur R. Tating", code:"CEA-RDI-CE-2023-0001", copies:1 },
  { barcode:"0439616380", title:"Utilization of Rice Husk as Additional Material for Concrete Hollow Block (CHB)", authors:"Aldave, John Xernan Carlo M.; Beo, Kathereen Kaye P.; Aznar, Camila Joy L.; Eusebio, Jonathan D.", year:"2023", adviser:"Engr. Melvin McArthur R. Tating", code:"CEA-RDI-CE-2023-0002", copies:2 },
  { barcode:"5652241457", title:"Precast Walls Using Fiber Cement Board and Shredded Rubber Tires and Plastic Bottles Mixed with Cement", authors:"Aquino, Polo Gabriel B.; Arsapa, Kasanand M.; Soledad, Kenneth P.", year:"2023", adviser:"Engr. Michael M. Traballo", code:"CEA-RDI-CE-2023-0003", copies:1 },
  { barcode:"9483696031", title:"Design of Emergency Shelter for Abaca Farmers in San Miguel, Panganiban, Catanduanes", authors:"Visaya, Jo Hua Alex V.; Rendzy V.; Renzo M.; Arsapa, Kas Amand M.", year:"2023", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDI-CE-2023-0004", copies:1 },
  { barcode:"9285945193", title:"Design of Two Storey Multi-Purpose Disaster Resilient Building at Brgy. Solong, San Miguel, Catanduanes", authors:"Mangalinan F.; Mendoza, Josephine E.; Bernal, Renato T.", year:"2023", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDI-CE-2023-0005", copies:1 },
  { barcode:"6133670203", title:"Design of Retaining Wall for Landslide Mitigation Project in Summit, Viga, Catanduanes", authors:"Velchez, Juan Jaime V.; Arnaldo, Mark Francis S.; Asincion, Joshua T.", year:"2023", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDI-CE-2023-0006", copies:1 },
  { barcode:"7737404115", title:"Design of Waste Water Treatment Facility for Virac Town Center and Residential Households", authors:"Baja Ro, Sherwin Gay T.; Laynes, John Dominie V.; Romero, Gino Daniel T.", year:"2023", adviser:"Engr. Michael M. Traballo", code:"CEA-RDI-CE-2023-0007", copies:2 },
  { barcode:"9078812258", title:"An Investigation of Shredded Low-Density Polyethylene Plastic as Partial Replacement for San Concrete Hollow Block Production", authors:"Manrique, Mark Bryan P.; Quintal, Chester T.; Tablo, Jay M.; Ternida, Reca T.", year:"2023", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CE-2023-0024", copies:1 },
  { barcode:"0669292956", title:"Proposed Three Storey Academic Building for the College of Civil Engineering and Architecture at Catanduanes State University", authors:"Pareja, Richie D.; Tating, Kristine Joy L.; Tomon, Brian Francis John F.; Mendoza, Christopher Jan C.", year:"2023", adviser:"Engr. Melvin McArthur R. Tating", code:"CEA-RDS-CE-2023-0025", copies:1 },
  { barcode:"1003385598", title:"Engineering Intervention to Mitigate the Flooding in Palta Small Junction Road, Virac, Catanduanes", authors:"Morales, Aeron Jay T.; Taboy, Dixie R.; Timcla, Suzaine Rose T.; Torrecampo, Justine T.", year:"2023", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2023-0026", copies:1 },
  { barcode:"0890733952", title:"Recycled HDPE-Abaca (Musa Textilis) Fiber Blocks as Partition Walls", authors:"Tapel, Marielawrence T.; Taron, Ebica D.; Torrecampo, Justine T.", year:"2023", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CE-2023-0027", copies:1 },
  { barcode:"9047322022", title:"Proposed Retaining Wall in Paniquihan, Baras, Catanduanes", authors:"Tapel, Maryclawrence T.; Tarrquin, Rapry S.; Tatad, Ari Liyah Kie T.", year:"2023", adviser:"Engr. Michael M. Traballo", code:"CEA-RDS-CE-2023-0028", copies:1 },
  { barcode:"8216376057", title:"A Frequently Asked Questions Chatbot for Catanduanes State University: College of Engineering and Architecture", authors:"Abines, Sheila Mae; Borre, Robert Mae U.; Marcos, Kate M.; Noior, Sarah Jean P.", year:"2024", adviser:"Engr. Ronnie S. Antelices", code:"CEA-RDS-CPE-2024-0001", copies:2 },
  { barcode:"9761294526", title:"Design and Development of a Web-Based Scholastic Document Request System for Catanduanes State University", authors:"Alvar, Charles Emmanuel R.; Benavidez, Charles Joval T.; Cueva, John Carl C.; Teves, Noime A.", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0002", copies:2 },
  { barcode:"2690216108", title:"Convolutional Neutral Network (CNN)-Based Egg Sorting Device", authors:"Antonio, Princess Nessie B.; Buban, Jo Iwella Mae S.; Buizon, Matt Lemuel C.; Cristo, Freymond D.", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0003", copies:2 },
  { barcode:"8422887521", title:"Finger Print Voting System: A Step Towards Modernizing Electoral and Voting Competition Process in Catanduanes State University", authors:"Molod, Jhon Thied P.; Tayam, John Lawrence; Tablate, Arnold; Zuniega, Ella Joy D.", year:"2024", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CPE-2024-0004", copies:2 },
  { barcode:"0689996167", title:"Development of a Holistic Portable Water Assessment Testing Device Integrating Turbidity, PH, and Total Dissolved Solids", authors:"Asuncion, Chloe Mae T.; Blanccaslon, Diana Mariane C.; Ogema, Maxine T.; Toledo, Rose Ann P.", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0005", copies:2 },
  { barcode:"7547250197", title:"ICAS: A Basis for Availing Discounts for Students, PWDs and Senior Citizen in Catanduanes", authors:"Torrenova, Alfie Amdro T.; Vargas, Jethro Jeric B.; Avila, Deryle Kate T.", year:"2024", adviser:"Engr. Ronnie S. Antelices", code:"CEA-RDS-CPE-2024-0006", copies:2 },
  { barcode:"1382083262", title:"Optimization of a Smart Aquaponics", authors:"Opistan, Christian M.; Reyes, Sheryl T.; Tadao, John Daryl D.; Bernal, Jessica O.", year:"2024", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CPE-2024-0007", copies:2 },
  { barcode:"5940185959", title:"Creation and Implementation of Biometric Attendance and Access Management System for CEA Classrooms", authors:"Gascon, Lucca B.; Mensie S., Buela D.; Palcon V., Cielo T.", year:"2024", adviser:"Engr. Ronnie S. Antelices", code:"CEA-RDS-CPE-2024-0008", copies:2 },
  { barcode:"7699046172", title:"Design and Development of IOT-Based E-Shopping Cart", authors:"Dolon, Aenes Angela T.; Eyam, Angel Janaelle E.; Glama, Joshua Q.; Paoa, Jhonnely F.", year:"2024", adviser:"Engr. Ronnie S. Antelices", code:"CEA-RDS-CPE-2024-0017", copies:2 },
  { barcode:"1131416984", title:"Enhanced Parking and Non-Parking Vehicle Detection System at Catanduanes State University", authors:"Miares, Wilfredo B.; Palero, Riedel Yatso C.; Tarroduin, Ronnel S.; Tayoto, Mark Dave T.", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0018", copies:2 },
  { barcode:"0197437717", title:"Design and Development of Speed Limit Notification System Utilizing IEEE 802.11 Wireless Access Points", authors:"Mendoza, Naice Edward C.; Sualibo, Victor Edward L.; Tupir, Adrian Jay V.", year:"2024", adviser:"Engr. Ronnie S. Antelices", code:"CEA-RDS-CPE-2024-0019", copies:2 },
  { barcode:"2442292798", title:"Classification of Edible and Poisonous Wild Mushrooms: A Deep CNN Application", authors:"Taraw, Jean Kaye M.; Pildred, Frankie R.; Santiago, Danielle A.; Torrego Sa, Necole A.", year:"2024", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CPE-2024-0020", copies:2 },
  { barcode:"6858799878", title:"Solar Powered Eco-Bin Using Object Detection", authors:"Vargas, Vincent; Segismundo, Princess Mae; Tabayag, Nicol", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0021", copies:2 },
  { barcode:"4368324695", title:"Smart Sensor-Based Approach: A Rain Detection, Monitoring and Protection Device", authors:"Toledo, John S. Marquez; Zuniega, Christian S.", year:"2024", adviser:"Dr. Gemma G. Acedo", code:"CEA-RDS-CPE-2024-0022", copies:2 },
  { barcode:"2455590723", title:"Development of a Comprehensive System for Problems and Learning Process in Cavintan, Virac, Catanduanes", authors:"Tadio, John Basil T.; Timao, Daniel T.; Garcia, Laurence J.; Taway, James Richard", year:"2024", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CPE-2024-0023", copies:2 },
  { barcode:"0149852333", title:"Understanding the Impacts of IOT-Based AI Technologies on Academic Performance of Tertiary-Level Students at CATSU", authors:"Teves, Louisse Millen S.", year:"2024", adviser:"Engr. Lyndon T.B. Uenconsejo", code:"CEA-RDS-CPE-2024-0024", copies:2 },
  { barcode:"7679247080", title:"Design and Installation of a Wind Turbine Generator at Virac Boulevard to Supply Energy for Lighting", authors:"Vibala, Marie Christian S.; Tolentino, Daniel T.; Trinidad, Liza Mae T.", year:"2024", adviser:"Engr. Jose P. Tapel", code:"CEA-RDS-CPE-2024-0025", copies:2 },
  { barcode:"8591326341", title:"Assessment and Design of Rain Roof Water System for Sustainable Water Resources Management in Cavintan, Virac, Catanduanes", authors:"Abelio, Michael Lawrence T.; Gianan, Herman I.; Isoriena, Adam Federico A.; Samudio, Archie Bien", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0001", copies:2 },
  { barcode:"9738677128", title:"Enhancing Water Resource Efficiency and Sustainability Through the Integration of Sensor-Enabled Smart Rainwater Harvesting Systems", authors:"Abuke, John Carlo I.; Mendoza, Shayne Jane T.; Alvarez, Mary Ann P.; Zuniega, Jethro Yves R.", year:"2024", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-CE-2024-0002", copies:2 },
  { barcode:"3138395388", title:"A Convenient Pursuit for Career: Designing a Three Storey Engineering and Architectural Review Center", authors:"Bibundo, Shayne Mae T.; Zuniega, Ella Joy D.; Alvarez, Mary Ann P.; Carlo P. Andrew L. Tioxon", year:"2024", adviser:"Engr. Melvyn McArthur Tating", code:"CEA-RDS-CE-2024-0003", copies:2 },
  { barcode:"1483709117", title:"Enhancing Campus Mobility at Catanduanes State University in Line with the UI Greenmetric", authors:"Tablate, Arnold P.; Pastor, Daphne Fe.; Alavo, John Lawrence S.; Zuniega, Ella Joy D.", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0004", copies:2 },
  { barcode:"6394921306", title:"Development of Abaca (Musa Textilis) Fiber Mat for Soil Erosion Mitigation", authors:"Dcellos, Jay Mark N.; Aquino, Jim G.; Bernsal, Glory Site T.; Datavon, John Paul M.", year:"2024", adviser:"Engr. Melvyn McArthur Tating", code:"CEA-RDS-CE-2024-0005", copies:2 },
  { barcode:"9145213421", title:"Typhoon Resilient House Design for Resettlement Housing in Dugui Too, Virac, Catanduanes", authors:"Beon, Nathalie Nicole M.; Ogena, Maxine T.; Gallora, Raiza A.", year:"2024", adviser:"Arch. Jose Ong", code:"CEA-RDS-CE-2024-0006", copies:2 },
  { barcode:"3349613940", title:"Rock Phosphate as an Alternative Fine Aggregates for Wall Plastering with Banana Leaf Ash as an Admixture of Cement", authors:"Laurente, King Ivan P.; Sualibid, Julia Mae I.; Tafinate, Chastine Kate T.", year:"2024", adviser:"Engr. Melvyn McArthur Tating", code:"CEA-RDS-CE-2024-0007", copies:2 },
  { barcode:"7166585216", title:"Design of Flood Control System at Simamla (Proper), Virac, Catanduanes", authors:"Barra, Grace Bell N.; Baira, Rover Justin T.; Bocaya, Joseph Negar P.; Gianan, Mea Janelle S.", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0108", copies:2 },
  { barcode:"3081649359", title:"Optimizing Campus Mobility: Designing a Three Storey Parking Structure for Catanduanes State University", authors:"Batalla, Mike Deither M.; Clemente, Nathaniel V.; Elpaguiarista, John Jane C.", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0109", copies:2 },
  { barcode:"1045734921", title:"Integrating Green Roof into Building: An Engineering Approach to Sustainable Rural Development", authors:"Catacutan, Princess T.; Osorio, Krisna Joshua C.; Soriano, Airah Mae O.", year:"2024", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-CE-2024-0110", copies:2 },
  { barcode:"4206904403", title:"PETWith Fibers from Banana Pseudostem and Coconut Huskas Floor Tiles", authors:"Tirepol, Shiela Mae I.; Tujibero, Raphunsel T.; Timao, Alvin T.", year:"2024", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2024-0111", copies:2 },
  { barcode:"2854033104", title:"Designing Typhoon-Resilient Multi-Purpose Building at Palta, Virac, Catanduanes", authors:"Camara, Alvin D.; Arroquin, Rustom O.; Zafe, Jomari R.; Zuniega, Gilyn Valerie Z.", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0112", copies:2 },
  { barcode:"3476563838", title:"Implementation of Operational Construction Safety Requirements in Private Firms in Virac, Catanduanes", authors:"Carranza, Alyssa; Ortiz, Monica M.; Santelices, Denise Cesca A.; Surmiento, John Leo Z.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0113", copies:2 },
  { barcode:"7142066454", title:"Evaluating Concrete Casting Strategic Construction: Quality Control and Assurance in DPWH Projects in Virac, Catanduanes", authors:"Sales, Jhon Mark D.; Sorhao, Aaron Howell G.; De Quiroz, Edrian A.; Lumari, Ian Lee S.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0114", copies:2 },
  { barcode:"4653573708", title:"Conceptualization and Design of Seismic and Wind-Resistant Bridge in Barangay San Isidro, San Andres, Catanduanes", authors:"Presentacion, John Lloyd V.; Toledana, Randy", year:"2024", adviser:"Engr. Melvyn McArthur Tating", code:"CEA-RDS-CE-2024-0115", copies:2 },
  { barcode:"6299301086", title:"Investigation of Permeable Concrete Pavement Using Abaca Fiber Reinforcement", authors:"Distura, Han Cyrus D.; Tabios, Joenel A.; Taopo, John Vergel P.; Tindencia, Lee David S.", year:"2024", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2024-0116", copies:0 },
  { barcode:"4336824669", title:"Design of Solar-Powered Hybrid Water Pumping System for Enhanced Water Resource Management at Barangay Tubaon, Virac, Catanduanes", authors:"Masagca, John Reggie T.; Ricidulfo, John Reggie T.; Tapim, Ivan Chris P.", year:"2024", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-CE-2024-0117", copies:1 },
  { barcode:"5205883307", title:"Alternative Waterproofing Apog Powder and Abaca Fiber for the Protection of Concrete Houses in Virac, Catanduanes", authors:"El Jsebio, Derald Jay O.; Masagca, John Reggie T.; Ricidulfo, John Reggie T.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0118", copies:2 },
  { barcode:"0584515400", title:"Design and Implementation of Rain Water Harvesting System for BHW Center in Calatagan Proper, Virac, Catanduanes", authors:"Evan Langit, Gio Domingo M.; Romero, Sophia Lorain E.G.; Sorhao, Aaron Howell L.G.", year:"2024", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2024-0119", copies:2 },
  { barcode:"7916824927", title:"Quality Assessment of Reinforcing Steel Bars from Hardware Stores in Catanduanes", authors:"Icamen, Daniella Charisse V.; Mendoza, Rosette T.; Guerrero, Ransel C.; Taboy, Zoila Kaye P.", year:"2024", adviser:"Arch. Jose Ong", code:"CEA-RDS-CE-2024-0120", copies:2 },
  { barcode:"1282733260", title:"Design and Implementation of Rain Water Harvesting System at CATSU-CICCS", authors:"Tabuena, Allysa Mae E.; Sarmiento, John Leo Z.; Tumulala, Christian Jose Ph T.", year:"2024", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2024-0121", copies:2 },
  { barcode:"0765021242", title:"Design and Optimization of Rainwater Harvesting Tank in Catanduanes", authors:"Lubay, Jirome T.; Sanchez, Jerwin C.; Tobecampo", year:"2024", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-CE-2024-0122", copies:1 },
  { barcode:"5207263680", title:"Investigating the Effect on Compressive Strength and Water Absorption of Sugarcane Bagasse Ash and Basaltic Tuff Rock Powder", authors:"Maisirag, Ana Mikaeli V.; Tabios, John Chris T.; Javil, Dennise Mae V.; Olino, Medeiza O.", year:"2024", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2024-0123", copies:2 },
  { barcode:"1332568295", title:"Eggshell Powder as a Sustainability Additive for Paper-Based Plastering Materials", authors:"Jake Adrian S. Muñoz; Von Francis M. Ibayan; Julier Von G. Peña; Dhondie A. Araojo", year:"2024", adviser:"Engr. Dexter M. Toyado", code:"CEA-RDS-CE-2024-0124", copies:2 },
  { barcode:"9325581893", title:"Utilization of Coconut (Cocos nucifera) Husk and Polyethylene Terephthalate (PET) Bonded with Polymer Resin as an Alternative Production for Plywood", authors:"Sarmiento, Jamby B.; Tapanan, Jhoevan; Taboy, Peter Jhon G.; Tasarra, Jamaica T.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0125", copies:1 },
  { barcode:"2725964163", title:"Assessing the Durability of Concrete Incorporating Coconut Fiber and Recycled Concrete Aggregates", authors:"Olesco, Aleja B.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0126", copies:0 },
  { barcode:"3158767336", title:"Enhancing Resilience: Designing a Disaster Resistant Two Storey Multipurpose Barangay Hall in Calatagan Proper, Virac, Catanduanes", authors:"Tablizo, Rudy Kenneth T.; Tasarra, Jamaica T.; Murillo, Fernando Jr.; Matienzo, John Patrick", year:"2024", adviser:"Engr. Melvyn McArthur Tating", code:"CEA-RDS-CE-2024-0127", copies:1 },
  { barcode:"9583437403", title:"An Analytical Study on Effectiveness of First-Flush Roof Runoff Harvesting in Catanduanes", authors:"Alberto, Ruth Danielle P.; Jemiera, Shekinah B.; Teokerio, Siocon M.", year:"2024", adviser:"Engr. Karen A. Bañas", code:"CEA-RDS-CE-2024-0128", copies:2 },
  { barcode:"8259428596", title:"Construction Strategic Model of Completed Construction Project at Catanduanes State University", authors:"Tesore Ro, Czarina Mae J.; Tindug An, Niuel Jhon D.", year:"2024", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2024-0129", copies:1 },
  { barcode:"8234504833", title:"Level of Awareness of Drivers About Traffic Signages in Virac, Catanduanes", authors:"Bagadong, Elias Jobert; Panit, John Jeric M.; Pinera, Leo Arthur I.; Torcelino, Adrian B.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0001", copies:1 },
  { barcode:"6083631902", title:"Assessment of Commuter Satisfaction with Transportation Modes at Virac Terminal Nals", authors:"Gelito, Daryl T.; Gianan, Jasper Ryan C.; Marquez, Patricia Louise P.; Reyes, Ah Na Mae S.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0002", copies:1 },
  { barcode:"6823292872", title:"Traffic Volume Study of Road Junctions in Virac Public Market", authors:"Dela Cruz, Fernando A.; Esparas, Renzo Manuel Z.; Romero, John Denzel T.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0003", copies:1 },
  { barcode:"1187744161", title:"Accident Analysis on the Major Thoroughfares in Virac, Catanduanes (2024)", authors:"Dela Cruz, Mikaela Lyka T.; Lumabi, Biyan T.; Martinez, Russel M.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0004", copies:1 },
  { barcode:"7368163464", title:"Comparison of Driving Behaviors Between Licensed and Unlicensed Drivers in Virac, Catanduanes Updated 2024", authors:"Marquez, Jessie John S.; Ortiz, Destiny H.; Panit, Ruby Ann A.; Reyes, Julius Cholo D.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0005", copies:1 },
  { barcode:"7168671091", title:"Analyzing Driver's Response: A Study on Motorists Awareness of Road Signs and Markings", authors:"Tasing, Kim Udorn; Sorreda, Izzy Grysta B.; Tating, Maiah Rhianwary P.; Toguero, Russeleey T.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0006", copies:1 },
  { barcode:"5297604997", title:"Comparison of Driving Behaviors Between Licensed and Unlicensed Drivers in Virac, Catanduanes (Section 4D)", authors:"Angona, Paul Jacob Ta.; Lopez, Anita Corita; Espinar B., Christian", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0007", copies:1 },
  { barcode:"6670455949", title:"Assessment of Parking Management in Center Mall of Virac", authors:"Camacho, Feona Rima E.; Magino, Janna Mae C.; Toguero, Jed Edgar; Vargas, A. Janine", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0008", copies:1 },
  { barcode:"5999617988", title:"Assessment of Parking Management System in Downtown Area in Virac, Catanduanes", authors:"Barro, Angel D.; Camano, Ivan Henriz J.; Benavidez, John Carl D.; Diwyatad, John Jvald", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0009", copies:1 },
  { barcode:"5562846421", title:"Level of Awareness of Student Drivers About Traffic Signages in Catanduanes State University", authors:"Mirabilite, Jean; Tenerife, Kristine Faith; Tugano, Baby Angel; Alejandro, Ritzia", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0010", copies:1 },
  { barcode:"2243087637", title:"Analysis of Traffic Volume at Intersections in Front of Catanduanes National High School, Virac Pilot Elementary School, and Catanduanes State University", authors:"Omoato, Rachel Abegail S.; Surbano, Rodolfo Da.; Gianan, Kenneth Andrew T.E.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0011", copies:1 },
  { barcode:"0085727714", title:"Assessing Students Drivers Awareness and Compliance with Traffic Rules and Regulations at Catanduanes State University", authors:"Traquena, John Christian T.; Magtagnoib, Althea; Torres, Jamaica Mae F.", year:"2024", adviser:"Engr. Rene Constantine J. Avila", code:"CEA-RDS-RO-2024-0012", copies:1 },
  { barcode:"9165515236", title:"Design and Development of Ad-Hoc Communication Device for Off-Grid and Disaster Resilient Network", authors:"Dominguez, Carmin Elly V.; Salosngos, Sophia; Tud, Alvon Jedrix C.; Fernando, John Paulo B.", year:"2025", adviser:"Engr. Nanette M. Valeza", code:"CEA-RDS-CPE-2025-0009", copies:2 },
  { barcode:"4890173627", title:"E-Catsulta: An Integrated Online System for Appointment, Registration, and Health Services Management at Catanduanes State University Clinic", authors:"Magdabao S., Mon Christian B.; Magno, Jona Grant T.; Martinez, Josue T.; Sales, Salvador A.", year:"2025", adviser:"Engr. Morris U. Aquino", code:"CEA-RDS-CPE-2025-0010", copies:2 },
  { barcode:"1785063749", title:"Development of an Arduino-Based Off-Grid Acoustic Sensor System for Detecting and Deterring Green Leaf-Hopper (Cicadellidae Viridis)", authors:"Potenciano, Alvino R.; Bien, Avena C.; Lopez, Kurt Russell B.", year:"2025", adviser:"Engr. Patrick Jude Bautista", code:"CEA-RDS-CPE-2025-0011", copies:2 },
  { barcode:"4366050872", title:"Improving Drivers' Awareness: Development of Blind Curve Warning System Using Multiple Infrared Sensors", authors:"Sevilla, Kenneth Christian N.; Soner, Shali Emar V.; Talan, Alan Jaykelie T.; Bien, Jhosen B.", year:"2025", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2025-0012", copies:2 },
  { barcode:"7733337022", title:"Adaptive Traffic Light Using Machine Learning and Computer Vision", authors:"Cabrera, Katrina T.; Manabat, Marianne Nicole; Angeles, Kyle Martin M.", year:"2025", adviser:"Engr. Morris U. Aquino", code:"CEA-RDS-CPE-2025-0013", copies:2 },
  { barcode:"7459188595", title:"Development of an Image Processing-Based System for Real-Time Corn Maturity Detection to Optimize Harvest Timing in Agriculture", authors:"Beltran, Kent Henrick V.; Bradecina, Dave Ryan; Garcia, Carlos; Magdaraog, Trisha Jane G.", year:"2025", adviser:"Engr. Morris U. Aquino", code:"CEA-RDS-CPE-2025-0001", copies:2 },
  { barcode:"9698501593", title:"Development of a Flood Monitoring and Management System: Integrating IOT and Renewable Energy Solutions", authors:"Borja, Jamela Trez E.; Isidoro, Monika B.; Laurente, Rica Joy E.", year:"2025", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2025-0002", copies:2 },
  { barcode:"9397174794", title:"Computer Vision Based Coconut Fruit Maturity Classification Device", authors:"Alcantara, Jay S.; Manibale, Marvin C.; Tioxon, Carlo P. Andrew L.", year:"2025", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2025-0003", copies:2 },
  { barcode:"1082051512", title:"Prototype Landslide Detection System with GSM Based Alerting", authors:"Mano Jsuid, Fatima Nicole Felicity T.; Navero, Arrannie Gail C.; Torino, Danielle T.; Buizon, Ana Marie G.", year:"2025", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2025-0004", copies:2 },
  { barcode:"9546927704", title:"Design and Implementation of an Automated Bangus (Milkfish) Size and Weight Sorting Utilizing Computer Vision", authors:"Bustamante, Pearl Hannah; Tanaael, Kristine M.; Valeza, Crystal Joy; Diwata, Almaiko Veen", year:"2025", adviser:"Engr. Ronnie B. Santelices", code:"CEA-RDS-CPE-2025-0005", copies:2 },
  { barcode:"4267255634", title:"Automated Audit Report Generator for Catanduanes State University Student Organizations", authors:"Tapia, Charles; Besmonte, Dianne V.; Teokerio, Axel Son M.", year:"2025", adviser:"Engr. Morris U. Aquino", code:"CEA-RDS-CPE-2025-0006", copies:2 },
  { barcode:"8261624823", title:"Leveraging Data Analytics for Job Search Prediction and Career Advancement: A Systematic Solution", authors:"Manabat, Quinnie Marie; Omano, Marianel Joy", year:"2025", adviser:"Engr. Morris U. Aquino", code:"CEA-RDS-CPE-2025-0007", copies:2 },
  { barcode:"8181746908", title:"Development of Barangay Digital Kiosk-Based System for Streamlining Community Information and Document Management in the Province of Catanduanes", authors:"Del Barfio, Mark Glen V.; Jung Aya, Michaela; Reyes, Mae Carla M.; Tieston, Jester L.", year:"2025", adviser:"Engr. Patrick Jude Bautista", code:"CEA-RDS-CPE-2025-0008", copies:2 },
  { barcode:"4612220215", title:"Design of a Portable Water Filter for Hand Pumps Using Canarium Ovatum Shell Activated Carbon", authors:"Ala, Kreisha Angela A.; Bolocon, Joshua Va.; Lucero, Carlo Ro And R.; Samonte, Arvin L.", year:"2025", adviser:"Engr. Dexter R.M. Toyado", code:"CEA-RDS-CE-2025-0001", copies:2 },
  { barcode:"3994178513", title:"Shaping Careers Through Safety: The Influence of Safety Training on Civil Engineers' Development", authors:"Alcantara, Elbenilori B.; Cortelano, Miko Victor; Tadoy, Nap Air Elton; Tayobana, Allen", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0002", copies:2 },
  { barcode:"9558663585", title:"Assessment of the Performance of the Public Transport Services in Virac, Catanduanes", authors:"Daniel, Lovine T.; Vargas, Princess Staye; Tubeo, Nemi Elp.; Valeza, Grezelle May A.", year:"2025", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2025-0003", copies:2 },
  { barcode:"8579443269", title:"Seismic Evaluation of an Old RC Building in Virac Using Fiber Reinforced Polymer (CFRP)", authors:"Tajan, Mark Aris R.; Valeza, Grezelle May A.; Arguyin, Joshu Va.", year:"2025", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2025-0004", copies:2 },
  { barcode:"4688518132", title:"A Proposed Design of a Three Storey Engineering and Architecture at Catanduanes State University", authors:"Osorio, Pia Z.; Tomagan, Hannah Isabella D.; Villena, Edsel A.", year:"2025", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2025-0005", copies:2 },
  { barcode:"3618788856", title:"Public Transit Station Formation, Rate, Analysis: An Engineering Design and Analysis", authors:"Emplonio Vevo, Anthony T.; Emplonvevo, Janet J.; Teokerio, Axel Son M.; Besmonte, Dianne V.", year:"2025", adviser:"Engr. Melvyn McArthur R. Tating", code:"CEA-RDS-CE-2025-0006", copies:2 },
  { barcode:"3497129794", title:"Design of Water Storage Tank with Filtration System in Barangay Ma Asing, Sia, Virac, Catanduanes", authors:"Tayao, Kyle Ceds Gil; Tesorero, John Lueniel A.", year:"2025", adviser:"Engr. Dexter R.M. Toyado", code:"CEA-RDS-CE-2025-0007", copies:2 },
  { barcode:"5163337925", title:"Assessment of Construction Safety and Practices in LGU Virac Ongoing Projects", authors:"Tayao, Ayllle Ceds Gil; Tesorero, John Lueniel A.; Villairy, Callme KV.", year:"2025", adviser:"Engr. Dexter R.M. Toyado", code:"CEA-RDS-CE-2025-0008", copies:2 },
  { barcode:"1674918807", title:"Evaluating the Effectiveness of Seawalls Against Sea Level Rise and Extreme Weather Events in Bal Doc, Pandan", authors:"Celeste, Mark Andre; Trinidad, Jasper Jan; Timbal, John Ald; Recleo Jr., Elim", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0010", copies:2 },
  { barcode:"1594875681", title:"Design of Sustainable Sewage Treatment Plant (STP) at Gogon Sirangan, Virac, Catanduanes", authors:"Tococ, Ivy T.; Trapago, Kim Kannie Grace T.; Tubao, Dan Jero Dan Trev C.; Tubao, Nell And Rev C.", year:"2025", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2025-0011", copies:2 },
  { barcode:"7763335490", title:"Structural Evaluation of Beams and Columns of Non-Engineered Two-Storey Reinforced Concrete Houses in Virac, Catanduanes", authors:"Esparas, Benizo Ma Nuez L.; Romero, John Deuzell T.", year:"2025", adviser:"Engr. Melvyn McArthur R. Tating", code:"CEA-RDS-CE-2025-0012", copies:2 },
  { barcode:"1032673947", title:"Design of a Typhoon-Resilient Two-Storey Bus Terminal with Integrated Emergency Shelter at Bicol Ibaroc Transport System Inc., Concepcion, Virac, Catanduanes", authors:"Dedicatoria, Micay N.; Reyes, Anna Vael S.", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0013", copies:2 },
  { barcode:"6107180618", title:"Inodoluminescent Road Marking: A Self-Illuminating Energy Efficient Solution for Safe Driving", authors:"Dela Cruz, Mekaela Lyka T.; Martinez, Michael La T.; Lumabi, Bryan T.; Romero, John Deuzell T.", year:"2025", adviser:"Engr. Melvyn McArthur R. Tating", code:"CEA-RDS-CE-2025-0014", copies:2 },
  { barcode:"5268774844", title:"Design of Water Storage and Distribution System for Spring Water Optimization for Calabnigan Valley in Calanigan, Virac, Catanduanes", authors:"Camara, Alvin D.; Arroquin, Rustom O.; Zafe, Jomari R.", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0015", copies:2 },
  { barcode:"4974302911", title:"Rebar Quality: An Assessment of Suppliers' Compliance with Philippine National Standards (PNS) and Environmental Effects on Rebar Corrosion in Virac, Catanduanes", authors:"Carranza, Alyssa; Ortiz, Monica M.; Santelices, Denise Cesca A.; Santos, Jessie John S.", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0016", copies:2 },
  { barcode:"2709567405", title:"Development and Performance Evaluation of Compacted Textile-Bitumen (CTB) Composite as a Sustainable Alternative to Concrete Sub-Base", authors:"Posada, Christine Joy M.; Timbal, Nirvana Rose D.; Torrecampo, Frances T.; Tejada, Berly N D.", year:"2025", adviser:"Engr. Melvyn McArthur R. Tating", code:"CEA-RDS-CE-2025-0017", copies:2 },
  { barcode:"3092341176", title:"Safety Culture Analysis of Public Infrastructure Construction: Insights from Virac, Catanduanes", authors:"Matengo, Lyra Leigh D.; Melano, John Francis B.; Johnnete, Mc Renivio; Lumari, Ian Lee S.", year:"2025", adviser:"Engr. Richmonilyn A. Salvador", code:"CEA-RDS-CE-2025-0018", copies:2 },
  { barcode:"6504521374", title:"Water Resource Management: Designing and Modelling of Rainwater Harvesting System in Imperial Subdivision Homes (SIV), Virac, Catanduanes", authors:"Tating, Maharir Anwar P.; Togueno, Russelle Y.", year:"2025", adviser:"Engr. Jerilee G. Tadoy", code:"CEA-RDS-CE-2025-0019", copies:2 },
];


async function seed() {
  let inserted = 0, skipped = 0;

  await withTransaction(async (client) => {
    console.log(`Seeding ${theses.length} thesis entries into room_id=${ROOM_ID}...\n`);

    for (const t of theses) {
      // 1. Find or create inventory_type by title
      //    (inventory_types.name has no UNIQUE constraint so ON CONFLICT won't work)
      const existing = await client.query(
        `SELECT id FROM inventory_types WHERE name = $1 LIMIT 1`, [t.title]
      );

      let typeId;
      if (existing.rows.length > 0) {
        typeId = existing.rows[0].id;
        // Update metadata in case authors/adviser changed
        await client.query(
          `UPDATE inventory_types SET metadata = $1 WHERE id = $2`,
          [JSON.stringify({ authors: t.authors, year: t.year, adviser: t.adviser, code: t.code }), typeId]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO inventory_types (sku, name, category, type, metadata)
           VALUES ($1, $2, 'Thesis / Research Output', 'borrowable', $3)
           RETURNING id`,
          [
            t.barcode,
            t.title,
            JSON.stringify({ authors: t.authors, year: t.year, adviser: t.adviser, code: t.code })
          ]
        );
        typeId = inserted.rows[0].id;
      }

      // 2. Skip if barcode already exists (idempotent)
      const exists = await client.query(
        `SELECT id FROM inventory_items WHERE barcode = $1`, [t.barcode]
      );
      if (exists.rows.length > 0) {
        console.log(`  SKIP (barcode exists): ${t.barcode}  ${t.code}`);
        skipped++;
        continue;
      }

      // 3. Insert one physical item per copy
      //    copies=0 means out of stock — insert 1 item and mark unavailable
      const numCopies = t.copies > 0 ? t.copies : 1;
      const status    = t.copies > 0 ? 'available' : 'archived';

      for (let i = 0; i < numCopies; i++) {
        // For multiple copies, append -2, -3, etc. to the barcode
        const itemBarcode = i === 0 ? t.barcode : `${t.barcode}-${i + 1}`;
        await client.query(
          `INSERT INTO inventory_items
             (inventory_type_id, barcode, location_room_id, status, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (barcode) DO NOTHING`,
          [
            typeId,
            itemBarcode,
            ROOM_ID,
            status,
            JSON.stringify({ code: t.code, year: t.year })
          ]
        );
      }

      console.log(`  OK [${t.copies} cop.]: ${t.barcode}  ${t.code}  ${t.title.substring(0,60)}...`);
      inserted++;
    }

    console.log(`\nDone. Inserted: ${inserted}  Skipped: ${skipped}`);
  });

  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
