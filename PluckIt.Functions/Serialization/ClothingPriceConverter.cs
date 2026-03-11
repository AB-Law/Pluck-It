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
        // Legacy format: plain number.
        if (reader.TokenType == JsonTokenType.Number)
        {
            return ReadLegacyPrice(ref reader);
        }

        // New format: object.
        if (reader.TokenType == JsonTokenType.StartObject)
        {
            return ReadFromObject(ref reader);
        }

        throw new JsonException(
            $"Unexpected token '{reader.TokenType}' when deserializing ClothingPrice. " +
            "Expected a number (legacy) or an object.");
    }

    private static ClothingPrice ReadFromObject(ref Utf8JsonReader reader)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        var root = doc.RootElement;

        var amount = root.TryGetProperty("amount", out var amountElement) && amountElement.TryGetDecimal(out var parsedAmount)
            ? parsedAmount
            : 0m;

        var originalCurrency = "USD";
        if (root.TryGetProperty("originalCurrency", out var currencyElement) &&
            currencyElement.ValueKind != JsonValueKind.Null)
        {
            originalCurrency = currencyElement.GetString() ?? "USD";
        }

        var purchaseDate = root.TryGetProperty("purchaseDate", out var dateElement) && dateElement.ValueKind != JsonValueKind.Null
            ? dateElement.GetString()
            : null;

        return new ClothingPrice
        {
            Amount = amount,
            OriginalCurrency = originalCurrency,
            PurchaseDate = purchaseDate
        };
    }

    private static ClothingPrice ReadLegacyPrice(ref Utf8JsonReader reader) => new ClothingPrice
    {
        Amount = reader.GetDecimal(),
        OriginalCurrency = "USD"
    };

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
