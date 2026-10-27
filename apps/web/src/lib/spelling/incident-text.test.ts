import { describe, expect, it } from "vitest";

import {
  formatAddress,
  formatCantonName,
  formatDistrictName,
  formatIncidentDetails,
  formatIncidentHeadline,
  formatProvinceName,
  formatStationName,
  formatTypeName
} from "@/lib/spelling/incident-text";

describe("formatIncidentHeadline", () => {
  it("writes the headline as a sentence with official place names", () => {
    expect(
      formatIncidentHeadline("ESTACION DE GARABITO REPORTA CORTO CIRCUITO EN TENDIDO ELECTRICO", {
        districtName: "JACO",
        cantonName: "GARABITO",
        provinceName: "PUNTARENAS"
      })
    ).toBe(
      "Estación de Garabito reporta cortocircuito en tendido eléctrico en Jacó, Garabito, Puntarenas"
    );
  });

  it("leaves out missing places", () => {
    expect(
      formatIncidentHeadline("COLISION CON PERSONA ATRAPADA", {
        districtName: null,
        cantonName: null,
        provinceName: null
      })
    ).toBe("Colisión con persona atrapada");
  });
});

describe("formatIncidentDetails", () => {
  it("restores accents on common words", () => {
    expect(formatIncidentDetails("PRECIPITACION DE VEHICULO EN EL CAUCE DE UN RIO")).toBe(
      "Precipitación de vehículo en el cauce de un río"
    );
  });

  it("keeps words that are valid without an accent", () => {
    expect(formatIncidentDetails("CORTO CIRCUITO EN LINEA CONTINUA HACIA EL NORTE")).toBe(
      "Cortocircuito en línea continua hacia el norte"
    );
  });

  it("fixes the operators' typos", () => {
    expect(formatIncidentDetails("ESTACION DE CARTAGO RPEORTA SERPIETE EN VIIVENDA")).toBe(
      "Estación de Cartago reporta serpiente en vivienda"
    );
    expect(formatIncidentDetails("PRECIPITACION DE VEHICULO AGUINDO")).toBe(
      "Precipitación de vehículo a guindo"
    );
  });

  it("capitalizes station names, including those led by an article", () => {
    expect(formatIncidentDetails("ESTACION DE LA FORTUNA REPORTA OSO PEREZOSO")).toBe(
      "Estación de La Fortuna reporta oso perezoso"
    );
    expect(formatIncidentDetails("ESTACION DEL ROBLE REPORTA QUEMA DE CHARRAL")).toBe(
      "Estación del Roble reporta quema de charral"
    );
    expect(formatIncidentDetails("ESTACION DE PEREZ ZELEDON REPORTA RESCATE DE PEREZOSO")).toBe(
      "Estación de Pérez Zeledón reporta rescate de perezoso"
    );
  });

  it("capitalizes a common word only where it names a station", () => {
    expect(formatIncidentDetails("ESTACION DE LIMON REPORTA ARBOL CON FUEGO")).toBe(
      "Estación de Limón reporta árbol con fuego"
    );
    expect(formatIncidentDetails("SERPIENTE EN EL JARDIN")).toBe("Serpiente en el jardín");
  });

  it("capitalizes personal names", () => {
    expect(formatIncidentDetails("ESTACION DEL AEROPUERTO JUAN SANTAMARIA REPORTA SERPIENTE")).toBe(
      "Estación del Aeropuerto Juan Santamaría reporta serpiente"
    );
  });

  it("keeps acronyms and unit numbers", () => {
    expect(formatIncidentDetails("UNIDAD M-112 REPORTA ESCAPE DE GAS LP")).toBe(
      "Unidad M-112 reporta escape de gas LP"
    );
    expect(formatIncidentDetails("UNIDAD M 34 REPORTA FUGA EN TUBERIA DE AYA")).toBe(
      "Unidad M 34 reporta fuga en tubería de AyA"
    );
    expect(formatIncidentDetails("C.C. EN ALUMBRADO PUBLICO")).toBe("C.C. en alumbrado público");
  });

  it("does not run a name across punctuation", () => {
    expect(formatIncidentDetails("FUEGO EN VIVIENDA, SAN JOSE")).toBe(
      "Fuego en vivienda, San José"
    );
  });

  it("leaves mixed-case text as written", () => {
    expect(formatIncidentDetails("Revisión de alarma")).toBe("Revisión de alarma");
  });
});

describe("place names", () => {
  it("uses the official spelling", () => {
    expect(formatProvinceName("SAN JOSE")).toBe("San José");
    expect(formatCantonName("LEON CORTES")).toBe("León Cortés");
    expect(formatDistrictName("JACO", "GARABITO")).toBe("Jacó");
  });

  it("spells a shared district name by its canton", () => {
    expect(formatDistrictName("SAN JOSE", "ALAJUELA")).toBe("San José");
  });

  it("falls back to title case with accents for unknown places", () => {
    expect(formatCantonName("ZONA MARITIMA DEL PACIFICO")).toBe("Zona Marítima del Pacífico");
  });
});

describe("formatStationName", () => {
  it("title-cases upper-case names and keeps typed ones", () => {
    expect(formatStationName("AEROPUERTO JUAN SANTAMARIA")).toBe("Aeropuerto Juan Santamaría");
    expect(formatStationName("Dirección Operativa de Bomberos")).toBe(
      "Dirección Operativa de Bomberos"
    );
  });
});

describe("formatAddress", () => {
  it("title-cases with accents and lower-case connectors, without fixing typos", () => {
    expect(formatAddress("PUNATRENAS ESPARZA FRENTE A LA IGLESIA CATOLICA EN UN LOTE")).toBe(
      "Punatrenas Esparza Frente a la Iglesia Católica en un Lote"
    );
    expect(formatAddress("FRENTE A LAS INSTALACIONES DEL MOPT O DEL INA")).toBe(
      "Frente a las Instalaciones del MOPT o del INA"
    );
  });
});

describe("formatTypeName", () => {
  it("lower-cases with accents for running text", () => {
    expect(formatTypeName("INTOXICACION POR MONOXIDO DE CARBONO")).toBe(
      "intoxicación por monóxido de carbono"
    );
    expect(formatTypeName("C.C. EN ALUMBRADO PUBLICO")).toBe("C.C. en alumbrado público");
  });
});
