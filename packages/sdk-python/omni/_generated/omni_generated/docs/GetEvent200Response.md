# GetEvent200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListEvents200ResponseItemsInner**](ListEvents200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.get_event200_response import GetEvent200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetEvent200Response from a JSON string
get_event200_response_instance = GetEvent200Response.from_json(json)
# print the JSON string representation of the object
print(GetEvent200Response.to_json())

# convert the object into a dict
get_event200_response_dict = get_event200_response_instance.to_dict()
# create an instance of GetEvent200Response from a dict
get_event200_response_from_dict = GetEvent200Response.from_dict(get_event200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


