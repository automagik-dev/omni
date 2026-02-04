# ListAccessRules200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListAccessRules200ResponseItemsInner]**](ListAccessRules200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_access_rules200_response import ListAccessRules200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListAccessRules200Response from a JSON string
list_access_rules200_response_instance = ListAccessRules200Response.from_json(json)
# print the JSON string representation of the object
print(ListAccessRules200Response.to_json())

# convert the object into a dict
list_access_rules200_response_dict = list_access_rules200_response_instance.to_dict()
# create an instance of ListAccessRules200Response from a dict
list_access_rules200_response_from_dict = ListAccessRules200Response.from_dict(list_access_rules200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


