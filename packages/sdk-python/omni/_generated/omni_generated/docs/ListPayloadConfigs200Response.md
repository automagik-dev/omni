# ListPayloadConfigs200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListPayloadConfigs200ResponseItemsInner]**](ListPayloadConfigs200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_payload_configs200_response import ListPayloadConfigs200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListPayloadConfigs200Response from a JSON string
list_payload_configs200_response_instance = ListPayloadConfigs200Response.from_json(json)
# print the JSON string representation of the object
print(ListPayloadConfigs200Response.to_json())

# convert the object into a dict
list_payload_configs200_response_dict = list_payload_configs200_response_instance.to_dict()
# create an instance of ListPayloadConfigs200Response from a dict
list_payload_configs200_response_from_dict = ListPayloadConfigs200Response.from_dict(list_payload_configs200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


