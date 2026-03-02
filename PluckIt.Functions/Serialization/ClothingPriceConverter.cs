using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using PluckIt.Core;

namespace PluckIt.Functions.Serialization;

/// <summary>
/// Backward-compatible converter for ClothingPrice.
/// Legacy Cosmos documents stored price as a plain decimal number.
/// New documents store it as an object: { "amount": ..., "originalCurrency": "..." }.
/// This converter handles both shapes on read; always writes as an object.
/// </summary>
public sealed class ClothingPriceConverter : JsonConverter<ClothingPrice>
{
    public override ClothingPrice? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        // Legacy format: plain number
        if (reader.TokenType == JsonTokenType.Number)
        {
            return new ClothingPrice
            {
                Amount = reader.GetDecimal(),
                OriginalCurrency = "USD"
            };
        }

        // New format: object
        if (reader.TokenType == JsonTokenType.StartObject)
        {
            var price = new ClothingPrice();
            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
            {
                if (reader.TokenType != JsonTokenType.PropertyName) continue;
                var prop = reader.GetString() ?? string.Empty;
                reader.Read();

                if (prop.Equals("amount", StringComparison.OrdinalIgnoreCase))
                    price.Amount = reader.GetDecimal();
                else if (prop.Equals("originalCurrency", StringComparison.OrdinalIgnoreCase))
                    price.OriginalCurrency = reader.TokenType == JsonTokenType.Null
                        ? "USD"
                        : (reader.GetString() ?? "USD");
                else if (prop.Equals("purchaseDate", StringComparison.OrdinalIgnoreCase))
                    price.PurchaseDate = reader.TokenType == JsonTokenType.Null ? null : reader.GetString();
                else
                    reader.Skip();
            }
            return price;
        }

        throw new JsonException(
            $"Unexpected token '{reader.TokenType}' when deserializing ClothingPrice. " +
            "Expected a number (legacy) or an object.");
    }

    public override void Write(Utf8JsonWriter writer, ClothingPrice value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteNumber("amount", value.Amount);
        writer.WriteString("originalCurrency", value.OriginalCurrency);
        if (value.PurchaseDate is not null)
            writer.WriteString("purchaseDate", value.PurchaseDate);
        writer.WriteEndObject();
    }
}
