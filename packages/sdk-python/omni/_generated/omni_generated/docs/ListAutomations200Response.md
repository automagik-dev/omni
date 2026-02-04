# ListAutomations200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[ListAutomations200ResponseItemsInner]**](ListAutomations200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.list_automations200_response import ListAutomations200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListAutomations200Response from a JSON string
list_automations200_response_instance = ListAutomations200Response.from_json(json)
# print the JSON string representation of the object
print(ListAutomations200Response.to_json())

# convert the object into a dict
list_automations200_response_dict = list_automations200_response_instance.to_dict()
# create an instance of ListAutomations200Response from a dict
list_automations200_response_from_dict = ListAutomations200Response.from_dict(list_automations200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


