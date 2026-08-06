import { z } from "@hono/zod-openapi";

export const typeByCodeRequest = z.object({
  code: z.string().openapi({
    param: { name: "code", in: "path", required: true },
    example: "1.1.1.4",
    description: "Incident type code (e.g., '1' for fire, '6.1.1.2.1' for snake rescue)"
  })
});

export const typeIncludeRequest = z.object({
  include: z
    .string()
    .optional()
    .refine(
      (value) => {
        if (!value) return true;
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .every((item) => item === "children" || item === "ancestors");
      },
      {
        message: "include must be 'children', 'ancestors', or a comma-separated combination"
      }
    )
    .openapi({
      description: "Comma-separated includes: children, ancestors",
      param: { in: "query" },
      example: "ancestors,children"
    })
});

export const typeSummary = z.object({
  code: z.string().openapi({
    description: "Incident type code",
    example: "1.1.1.4"
  }),
  name: z.string().openapi({
    description: "Incident type name",
    example: "ALMACEN FISCAL"
  }),
  imageUrl: z.string().url().openapi({
    description: "URL to the incident type image",
    example: "https://api.example.com/types/1.1.1.4/image"
  }),
  parentCode: z.string().nullable().openapi({
    description: "Parent incident type code",
    example: "1.1.1"
  }),
  level: z.number().int().openapi({
    description: "Depth level based on code segments",
    example: 4
  })
});

export const typesListResponse = z.object({
  items: z.array(typeSummary).openapi({
    description: "Flat list of incident types",
    example: [
      {
        code: "1",
        name: "EMERGENCIAS POR FUEGO",
        imageUrl: "https://api.example.com/types/1/image",
        parentCode: null,
        level: 1
      },
      {
        code: "1.1",
        name: "EN ESTRUCTURAS",
        imageUrl: "https://api.example.com/types/1.1/image",
        parentCode: "1",
        level: 2
      },
      {
        code: "1.1.1",
        name: "ALMACENAMIENTO",
        imageUrl: "https://api.example.com/types/1.1.1/image",
        parentCode: "1.1",
        level: 3
      },
      {
        code: "1.1.1.4",
        name: "ALMACEN FISCAL",
        imageUrl: "https://api.example.com/types/1.1.1.4/image",
        parentCode: "1.1.1",
        level: 4
      }
    ]
  })
});

export const typeChild = z.object({
  code: z.string().openapi({
    description: "Child incident type code",
    example: "1.1.1.4"
  }),
  name: z.string().openapi({
    description: "Child incident type name",
    example: "ALMACEN FISCAL"
  }),
  imageUrl: z.string().url().openapi({
    description: "URL to the incident type image",
    example: "https://api.example.com/types/1.1.1.4/image"
  })
});

export const typeAncestor = z.object({
  code: z.string().openapi({
    description: "Ancestor incident type code",
    example: "1.1.1"
  }),
  name: z.string().openapi({
    description: "Ancestor incident type name",
    example: "ALMACENAMIENTO"
  }),
  imageUrl: z.string().url().openapi({
    description: "URL to the incident type image",
    example: "https://api.example.com/types/1.1.1/image"
  }),
  level: z.number().int().openapi({
    description: "Depth level based on code segments",
    example: 3
  })
});

export const typeByCodeResponse = z.object({
  type: typeSummary,
  children: z
    .array(typeChild)
    .optional()
    .openapi({
      description: "Direct children of this incident type",
      example: [
        {
          code: "1.1.1.1",
          name: "BODEGAS",
          imageUrl: "https://api.example.com/types/1.1.1.1/image"
        },
        {
          code: "1.1.1.2",
          name: "SILOS",
          imageUrl: "https://api.example.com/types/1.1.1.2/image"
        },
        {
          code: "1.1.1.3",
          name: "TANQUES",
          imageUrl: "https://api.example.com/types/1.1.1.3/image"
        },
        {
          code: "1.1.1.4",
          name: "ALMACEN FISCAL",
          imageUrl: "https://api.example.com/types/1.1.1.4/image"
        }
      ]
    }),
  ancestors: z
    .array(typeAncestor)
    .optional()
    .openapi({
      description: "Ancestors of this incident type",
      example: [
        {
          code: "1",
          name: "EMERGENCIAS POR FUEGO",
          imageUrl: "https://api.example.com/types/1/image",
          level: 1
        },
        {
          code: "1.1",
          name: "EN ESTRUCTURAS",
          imageUrl: "https://api.example.com/types/1.1/image",
          level: 2
        },
        {
          code: "1.1.1",
          name: "ALMACENAMIENTO",
          imageUrl: "https://api.example.com/types/1.1.1/image",
          level: 3
        }
      ]
    })
});
