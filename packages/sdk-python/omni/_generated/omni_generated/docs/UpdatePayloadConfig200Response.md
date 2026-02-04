# UpdatePayloadConfig200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListPayloadConfigs200ResponseItemsInner**](ListPayloadConfigs200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.update_payload_config200_response import UpdatePayloadConfig200Response

# TODO update the JSON string below
json = "{}"
# create an instance of UpdatePayloadConfig200Response from a JSON string
update_payload_config200_response_instance = UpdatePayloadConfig200Response.from_json(json)
# print the JSON string representation of the object
print(UpdatePayloadConfig200Response.to_json())

# convert the object into a dict
update_payload_config200_response_dict = update_payload_config200_response_instance.to_dict()
# create an instance of UpdatePayloadConfig200Response from a dict
update_payload_config200_response_from_dict = UpdatePayloadConfig200Response.from_dict(update_payload_config200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


