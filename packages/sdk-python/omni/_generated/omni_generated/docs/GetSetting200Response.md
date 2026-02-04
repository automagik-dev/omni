# GetSetting200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ListSettings200ResponseItemsInner**](ListSettings200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.get_setting200_response import GetSetting200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetSetting200Response from a JSON string
get_setting200_response_instance = GetSetting200Response.from_json(json)
# print the JSON string representation of the object
print(GetSetting200Response.to_json())

# convert the object into a dict
get_setting200_response_dict = get_setting200_response_instance.to_dict()
# create an instance of GetSetting200Response from a dict
get_setting200_response_from_dict = GetSetting200Response.from_dict(get_setting200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


