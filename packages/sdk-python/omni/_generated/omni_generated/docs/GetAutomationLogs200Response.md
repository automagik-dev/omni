# GetAutomationLogs200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[GetAutomationLogs200ResponseItemsInner]**](GetAutomationLogs200ResponseItemsInner.md) |  | 
**meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Example

```python
from omni_generated.models.get_automation_logs200_response import GetAutomationLogs200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetAutomationLogs200Response from a JSON string
get_automation_logs200_response_instance = GetAutomationLogs200Response.from_json(json)
# print the JSON string representation of the object
print(GetAutomationLogs200Response.to_json())

# convert the object into a dict
get_automation_logs200_response_dict = get_automation_logs200_response_instance.to_dict()
# create an instance of GetAutomationLogs200Response from a dict
get_automation_logs200_response_from_dict = GetAutomationLogs200Response.from_dict(get_automation_logs200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


