# ListSettings200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListSettings200ResponseItemsInner]**](ListSettings200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_settings200_response import ListSettings200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListSettings200Response from a JSON string
list_settings200_response_instance = ListSettings200Response.from_json(json)
# print the JSON string representation of the object
print(ListSettings200Response.to_json())

# convert the object into a dict
list_settings200_response_dict = list_settings200_response_instance.to_dict()
# create an instance of ListSettings200Response from a dict
list_settings200_response_from_dict = ListSettings200Response.from_dict(list_settings200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


