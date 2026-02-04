# GetPayloadStats200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetPayloadStats200ResponseData**](GetPayloadStats200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_payload_stats200_response import GetPayloadStats200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetPayloadStats200Response from a JSON string
get_payload_stats200_response_instance = GetPayloadStats200Response.from_json(json)
# print the JSON string representation of the object
print(GetPayloadStats200Response.to_json())

# convert the object into a dict
get_payload_stats200_response_dict = get_payload_stats200_response_instance.to_dict()
# create an instance of GetPayloadStats200Response from a dict
get_payload_stats200_response_from_dict = GetPayloadStats200Response.from_dict(get_payload_stats200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


